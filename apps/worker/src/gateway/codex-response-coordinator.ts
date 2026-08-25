import { randomBytes } from "node:crypto";

import { toDynamicTool, type DynamicToolCallResponse } from "@mytoken/contracts";
import {
  createGatewayResponse,
  functionCallOutputSchema,
  type CreateResponseRequest,
  type GatewayResponse,
  type ResponseFunctionCallItem,
} from "@mytoken/openai-compat";
import { Deferred, MyTokenError } from "@mytoken/shared";

import type { CodexAppServerClient } from "../app-server/client.js";
import type { OpenClawToolBroker, ToolCallEvent } from "../tool-bridge/openclaw-tool-broker.js";

interface ActiveSession {
  apiKeyId: string;
  threadId: string;
  turnId: string;
  generation: number;
  model: string;
  store: boolean;
  text: string;
  signals: SessionSignal[];
  waiter: Deferred<SessionSignal> | undefined;
}

type SessionSignal =
  | { type: "tool"; event: ToolCallEvent }
  | { type: "completed"; status: string; error: unknown }
  | { type: "security"; itemType: string };

export interface CodexResponseCoordinatorOptions {
  responseTimeoutMs?: number;
  workspace?: string;
}

export class CodexResponseCoordinator {
  readonly #client: CodexAppServerClient;
  readonly #broker: OpenClawToolBroker;
  readonly #responseTimeoutMs: number;
  readonly #workspace: string | undefined;
  readonly #sessionsByResponse = new Map<string, ActiveSession>();
  readonly #sessionsByTurn = new Map<string, ActiveSession>();

  constructor(
    client: CodexAppServerClient,
    broker: OpenClawToolBroker,
    options: CodexResponseCoordinatorOptions = {},
  ) {
    this.#client = client;
    this.#broker = broker;
    this.#responseTimeoutMs = options.responseTimeoutMs ?? 120_000;
    this.#workspace = options.workspace;

    broker.on("toolCall", (event: ToolCallEvent) => {
      const session = this.#sessionsByTurn.get(turnKey(event.threadId, event.turnId));
      if (session) this.#signal(session, { type: "tool", event });
    });
    client.onNotification("item/agentMessage/delta", (params) => this.#onAgentDelta(params));
    client.onNotification("turn/completed", (params) => this.#onTurnCompleted(params));
    client.onNotification("item/started", (params) => this.#onItemStarted(params));
  }

  isReady(): boolean {
    return this.#client.state === "ready";
  }

  async listModels(): Promise<Array<{ id: string; displayName: string }>> {
    const result = await this.#client.request("model/list", {
      includeHidden: false,
      limit: 100,
    });
    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new MyTokenError("invalid_model_list", "app-server returned an invalid model list");
    }
    return result.data.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string") return [];
      return [
        {
          id: entry.id,
          displayName: typeof entry.displayName === "string" ? entry.displayName : entry.id,
        },
      ];
    });
  }

  async createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string },
  ): Promise<GatewayResponse> {
    if (request.previous_response_id) {
      return this.#continueResponse(request, context.apiKeyId);
    }
    return this.#startResponse(request, context.apiKeyId);
  }

  async #startResponse(request: CreateResponseRequest, apiKeyId: string): Promise<GatewayResponse> {
    const threadParams: Record<string, unknown> = {
      model: request.model,
      approvalPolicy: "never",
      sandbox: "read-only",
      developerInstructions: buildDeveloperInstructions(request.instructions),
      dynamicTools: (request.tools ?? []).map(toDynamicTool),
    };
    if (this.#workspace) threadParams.cwd = this.#workspace;

    const threadResult = await this.#client.request("thread/start", threadParams);
    const threadId = nestedString(threadResult, "thread", "id");
    if (!threadId) {
      throw new MyTokenError("invalid_thread_start", "app-server did not return a thread id");
    }

    const { history, currentText } = splitInput(request.input);
    if (history.length > 0) {
      await this.#client.request("thread/inject_items", { threadId, items: history });
    }

    const turnResult = await this.#client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: currentText }],
      model: request.model,
      effort: request.reasoning?.effort,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    const turnId = nestedString(turnResult, "turn", "id");
    if (!turnId) {
      throw new MyTokenError("invalid_turn_start", "app-server did not return a turn id");
    }

    const session: ActiveSession = {
      apiKeyId,
      threadId,
      turnId,
      generation: this.#client.generation,
      model: request.model,
      store: request.store ?? false,
      text: "",
      signals: [],
      waiter: undefined,
    };
    this.#sessionsByTurn.set(turnKey(threadId, turnId), session);
    return this.#waitAndBuild(session);
  }

  async #continueResponse(
    request: CreateResponseRequest,
    apiKeyId: string,
  ): Promise<GatewayResponse> {
    const previousId = request.previous_response_id;
    if (!previousId) throw new MyTokenError("missing_previous_response", "Missing response id");
    const session = this.#sessionsByResponse.get(previousId);
    if (!session || session.apiKeyId !== apiKeyId) {
      throw new MyTokenError("response_not_found", "Previous response was not found");
    }
    if (session.generation !== this.#client.generation) {
      throw new MyTokenError("worker_generation_changed", "The Codex worker restarted");
    }

    const outputs = Array.isArray(request.input)
      ? request.input.flatMap((item) => {
          const result = functionCallOutputSchema.safeParse(item);
          return result.success ? [result.data] : [];
        })
      : [];
    if (outputs.length === 0) {
      throw new MyTokenError(
        "missing_function_call_output",
        "A tool continuation must contain function_call_output",
      );
    }

    for (const output of outputs) {
      const pending = this.#broker.get(output.call_id);
      if (!pending || pending.threadId !== session.threadId || pending.turnId !== session.turnId) {
        throw new MyTokenError(
          "tool_call_not_found",
          "Tool output does not belong to this response",
        );
      }
      const result: DynamicToolCallResponse = {
        success: true,
        contentItems: [{ type: "inputText", text: output.output }],
      };
      this.#broker.resolve(output.call_id, session.generation, result);
    }
    return this.#waitAndBuild(session);
  }

  async #waitAndBuild(session: ActiveSession): Promise<GatewayResponse> {
    const signal = await this.#nextSignal(session);
    const responseId = publicId("resp_myt");
    this.#sessionsByResponse.set(responseId, session);

    if (signal.type === "security") {
      await this.#interrupt(session);
      return failedResponse(responseId, session.model, "tool_execution_blocked");
    }

    if (signal.type === "tool") {
      await Promise.resolve();
      const calls = this.#broker.listForTurn(session.threadId, session.turnId);
      const output: ResponseFunctionCallItem[] = calls.map((call) => ({
        type: "function_call",
        id: publicId("fc_myt"),
        call_id: call.callId,
        name: call.tool,
        arguments:
          typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
        status: "completed",
      }));
      return createGatewayResponse({ id: responseId, model: session.model, output });
    }

    if (signal.status !== "completed") {
      return failedResponse(responseId, session.model, "upstream_turn_failed");
    }

    const response = createGatewayResponse({
      id: responseId,
      model: session.model,
      output: [
        {
          type: "message",
          id: publicId("msg_myt"),
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: session.text, annotations: [] }],
        },
      ],
    });
    this.#sessionsByTurn.delete(turnKey(session.threadId, session.turnId));
    if (!session.store) {
      void this.#client.request("thread/delete", { threadId: session.threadId }).catch(() => {});
    }
    return response;
  }

  #nextSignal(session: ActiveSession): Promise<SessionSignal> {
    const queued = session.signals.shift();
    if (queued) return Promise.resolve(queued);
    if (session.waiter) {
      return Promise.reject(
        new MyTokenError("response_already_waiting", "Another request is waiting on this turn"),
      );
    }
    const deferred = new Deferred<SessionSignal>();
    session.waiter = deferred;
    const timer = setTimeout(() => {
      if (session.waiter !== deferred) return;
      session.waiter = undefined;
      deferred.reject(new MyTokenError("response_timeout", "Timed out waiting for app-server"));
    }, this.#responseTimeoutMs);
    return deferred.promise.finally(() => clearTimeout(timer));
  }

  #signal(session: ActiveSession, signal: SessionSignal): void {
    const waiter = session.waiter;
    if (waiter) {
      session.waiter = undefined;
      waiter.resolve(signal);
    } else {
      session.signals.push(signal);
    }
  }

  #onAgentDelta(params: unknown): void {
    if (!isRecord(params)) return;
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    const delta = stringValue(params.delta);
    if (!threadId || !turnId || delta === undefined) return;
    const session = this.#sessionsByTurn.get(turnKey(threadId, turnId));
    if (session) session.text += delta;
  }

  #onTurnCompleted(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.turn)) return;
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turn.id);
    if (!threadId || !turnId) return;
    const session = this.#sessionsByTurn.get(turnKey(threadId, turnId));
    if (!session) return;
    this.#signal(session, {
      type: "completed",
      status: stringValue(params.turn.status) ?? "failed",
      error: params.turn.error,
    });
  }

  #onItemStarted(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.item)) return;
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    const itemType = stringValue(params.item.type);
    if (!threadId || !turnId || !itemType || !dangerousItemTypes.has(itemType)) return;
    const session = this.#sessionsByTurn.get(turnKey(threadId, turnId));
    if (session) this.#signal(session, { type: "security", itemType });
  }

  async #interrupt(session: ActiveSession): Promise<void> {
    try {
      await this.#client.request("turn/interrupt", {
        threadId: session.threadId,
        turnId: session.turnId,
      });
    } catch {
      // The security result remains failed even if interruption races with completion.
    }
  }
}

const dangerousItemTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
  "imageGeneration",
  "process",
  "collabAgentToolCall",
]);

function splitInput(input: CreateResponseRequest["input"]): {
  history: unknown[];
  currentText: string;
} {
  if (typeof input === "string") return { history: [], currentText: input };
  let currentIndex = -1;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (item && "role" in item && item.role === "user") {
      currentIndex = index;
      break;
    }
  }
  if (currentIndex < 0) {
    throw new MyTokenError("missing_user_input", "Response input must contain a user message");
  }
  const current = input[currentIndex];
  if (!current || !("content" in current)) {
    throw new MyTokenError("invalid_user_input", "User message content is missing");
  }
  const currentText =
    typeof current.content === "string"
      ? current.content
      : current.content.map((content) => content.text).join("\n");
  return { history: input.slice(0, currentIndex), currentText };
}

function buildDeveloperInstructions(instructions: string | undefined): string {
  const safety = [
    "You are the model backend for MyToken Gateway.",
    "Use only client-provided dynamic function tools when needed.",
    "Do not execute shell commands, read or write files, browse, call MCP, plugins, apps, or skills.",
    "Do not request additional permissions.",
  ].join("\n");
  return instructions ? `${safety}\n\nClient instructions:\n${instructions}` : safety;
}

function failedResponse(id: string, model: string, code: string): GatewayResponse {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "failed",
    model,
    output: [],
    output_text: "",
    error: {
      message: "The gateway could not complete the response.",
      type: "api_error",
      code,
      param: null,
    },
    usage: null,
    metadata: {},
  };
}

function publicId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\0${turnId}`;
}

function nestedString(value: unknown, parent: string, child: string): string | undefined {
  if (!isRecord(value) || !isRecord(value[parent])) return undefined;
  return stringValue(value[parent][child]);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
