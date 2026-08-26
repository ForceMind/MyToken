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
  declaredTools: Set<string>;
  usage: GatewayResponse["usage"];
  responseIds: Set<string>;
  streamQueue: SessionSignal[];
  streamWaiter: Deferred<SessionSignal> | undefined;
  streamQueuedBytes: number;
  streaming: boolean;
  streamItemId: string | undefined;
}

type SessionSignal =
  | { type: "delta"; delta: string }
  | { type: "tool"; event: ToolCallEvent }
  | { type: "completed"; status: string; error: unknown }
  | { type: "security"; itemType: string };

export interface CodexResponseCoordinatorOptions {
  responseTimeoutMs?: number;
  workspace?: string;
  enableClientTools?: boolean;
}

/** Provider-neutral events used by the internal NDJSON transport. */
export type GatewayStreamEvent =
  | {
      type: "response.created";
      response: Pick<GatewayResponse, "id" | "object" | "created_at" | "model">;
      itemId: string;
    }
  | { type: "text.delta"; delta: string }
  | { type: "response.completed"; response: GatewayResponse }
  | { type: "response.tool_call"; response: GatewayResponse }
  | { type: "response.failed"; response: GatewayResponse };

export class CodexResponseCoordinator {
  readonly #client: CodexAppServerClient;
  readonly #broker: OpenClawToolBroker;
  readonly #responseTimeoutMs: number;
  readonly #workspace: string | undefined;
  readonly #enableClientTools: boolean;
  readonly #sessionsByResponse = new Map<string, ActiveSession>();
  readonly #sessionsByTurn = new Map<string, ActiveSession>();
  readonly #orphanSignals = new Map<string, SessionSignal[]>();
  readonly #orphanText = new Map<string, string>();

  constructor(
    client: CodexAppServerClient,
    broker: OpenClawToolBroker,
    options: CodexResponseCoordinatorOptions = {},
  ) {
    this.#client = client;
    this.#broker = broker;
    this.#responseTimeoutMs = options.responseTimeoutMs ?? 120_000;
    this.#workspace = options.workspace;
    this.#enableClientTools = options.enableClientTools ?? false;

    broker.on("toolCall", (event: ToolCallEvent) => {
      const key = turnKey(event.threadId, event.turnId);
      const session = this.#sessionsByTurn.get(key);
      if (session && !session.declaredTools.has(event.tool)) {
        this.#broker.fail(event.callId, event.generation, "Undeclared client tool was rejected.");
        this.#signal(session, { type: "security", itemType: "undeclaredDynamicTool" });
        return;
      }
      this.#queueOrSignal(key, { type: "tool", event });
    });
    client.onNotification("item/agentMessage/delta", (params) => this.#onAgentDelta(params));
    client.onNotification("turn/completed", (params) => this.#onTurnCompleted(params));
    client.onNotification("item/started", (params) => this.#onItemStarted(params));
    client.onNotification("thread/tokenUsage/updated", (params) => this.#onTokenUsage(params));
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
    context: { apiKeyId: string; signal?: AbortSignal },
  ): Promise<GatewayResponse> {
    if (request.previous_response_id) {
      return this.#continueResponse(request, context.apiKeyId, context.signal);
    }
    return this.#startResponse(request, context.apiKeyId, context.signal);
  }

  /**
   * Streams actual app-server agentMessage deltas. This deliberately does not
   * split a completed response into artificial chunks.
   */
  async createResponseStream(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
    emit: (event: GatewayStreamEvent) => Promise<void> | void,
  ): Promise<void> {
    if (request.previous_response_id) {
      const response = await this.#continueResponse(request, context.apiKeyId, context.signal);
      const eventType = response.output.some((item) => item.type === "function_call")
        ? "response.tool_call"
        : response.status === "completed"
          ? "response.completed"
          : "response.failed";
      if (eventType === "response.tool_call") await emit({ type: eventType, response });
      else if (eventType === "response.completed") await emit({ type: eventType, response });
      else await emit({ type: "response.failed", response });
      return;
    }
    const session = await this.#startSession(request, context.apiKeyId, context.signal, true);
    const responseId = publicId("resp_myt");
    const itemId = publicId("msg_myt");
    session.streamItemId = itemId;
    this.#sessionsByResponse.set(responseId, session);
    session.responseIds.add(responseId);
    await emit({
      type: "response.created",
      response: {
        id: responseId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model: session.model,
      },
      itemId,
    });
    try {
      for (;;) {
        const signal = await this.#nextStreamSignal(session, context.signal);
        if (signal.type === "delta") {
          await emit({ type: "text.delta", delta: signal.delta });
          continue;
        }
        const response = await this.#responseForSignal(session, responseId, signal);
        if (response.output.some((item) => item.type === "function_call")) {
          await emit({ type: "response.tool_call", response });
          session.streaming = false;
          session.streamQueue.length = 0;
          session.streamQueuedBytes = 0;
          session.signals.length = 0;
        } else if (response.status === "completed") {
          await emit({ type: "response.completed", response });
        } else {
          await emit({ type: "response.failed", response });
        }
        return;
      }
    } catch (error) {
      await this.#abortSession(session);
      throw error;
    }
  }

  async #startResponse(
    request: CreateResponseRequest,
    apiKeyId: string,
    signal?: AbortSignal,
  ): Promise<GatewayResponse> {
    const session = await this.#startSession(request, apiKeyId, signal);
    return this.#waitSafely(session, signal);
  }

  async #startSession(
    request: CreateResponseRequest,
    apiKeyId: string,
    signal?: AbortSignal,
    streaming = false,
  ): Promise<ActiveSession> {
    if (signal?.aborted) throw new MyTokenError("client_disconnected", "Client disconnected");
    if ((request.tools?.length ?? 0) > 0 && !this.#enableClientTools) {
      throw new MyTokenError("client_tools_disabled", "Client function tools are disabled");
    }
    const threadParams: Record<string, unknown> = {
      model: request.model,
      approvalPolicy: "never",
      sandbox: "read-only",
      developerInstructions: buildDeveloperInstructions(request.instructions),
      ephemeral: true,
    };
    if (this.#enableClientTools) {
      threadParams.dynamicTools =
        request.tool_choice === "none" ? [] : (request.tools ?? []).map(toDynamicTool);
    }
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
      declaredTools: new Set((request.tools ?? []).map((tool) => tool.name)),
      usage: null,
      responseIds: new Set(),
      streamQueue: [],
      streamWaiter: undefined,
      streamQueuedBytes: 0,
      streaming,
      streamItemId: undefined,
    };
    const key = turnKey(threadId, turnId);
    this.#sessionsByTurn.set(key, session);
    session.text = this.#orphanText.get(key) ?? "";
    this.#orphanText.delete(key);
    session.signals.push(...(this.#orphanSignals.get(key) ?? []));
    this.#orphanSignals.delete(key);
    return session;
  }

  async #continueResponse(
    request: CreateResponseRequest,
    apiKeyId: string,
    signal?: AbortSignal,
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

    const seen = new Set<string>();
    const resolutions: Array<{ callId: string; result: DynamicToolCallResponse }> = [];
    for (const output of outputs) {
      if (seen.has(output.call_id)) {
        throw new MyTokenError("duplicate_function_call_output", "Tool output was submitted twice");
      }
      seen.add(output.call_id);
      const pending = this.#broker.get(output.call_id);
      if (!pending || pending.threadId !== session.threadId || pending.turnId !== session.turnId) {
        throw new MyTokenError(
          "tool_call_not_found",
          "Tool output does not belong to this response",
        );
      }
      resolutions.push({
        callId: output.call_id,
        result: {
          success: true,
          contentItems: [{ type: "inputText", text: output.output }],
        },
      });
    }
    for (const resolution of resolutions) {
      this.#broker.resolve(resolution.callId, session.generation, resolution.result);
    }
    return this.#waitSafely(session, signal);
  }

  async #waitSafely(session: ActiveSession, signal?: AbortSignal): Promise<GatewayResponse> {
    try {
      if (!signal) return await this.#waitAndBuild(session);
      if (signal.aborted) throw new MyTokenError("client_disconnected", "Client disconnected");
      return await Promise.race([
        this.#waitAndBuild(session),
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new MyTokenError("client_disconnected", "Client disconnected")),
            { once: true },
          );
        }),
      ]);
    } catch (error) {
      await this.#abortSession(session);
      throw error;
    }
  }

  async #waitAndBuild(session: ActiveSession): Promise<GatewayResponse> {
    const signal = await this.#nextSignal(session);
    const responseId = publicId("resp_myt");
    this.#sessionsByResponse.set(responseId, session);
    session.responseIds.add(responseId);

    return this.#responseForSignal(session, responseId, signal);
  }

  async #responseForSignal(
    session: ActiveSession,
    responseId: string,
    signal: SessionSignal,
  ): Promise<GatewayResponse> {
    if (signal.type === "delta")
      return this.#responseForSignal(session, responseId, await this.#nextSignal(session));

    if (signal.type === "security") {
      await this.#interrupt(session);
      const response = failedResponse(
        responseId,
        session.model,
        signal.itemType === "streamOverflow" ? "stream_overflow" : "tool_execution_blocked",
      );
      this.#removeSession(session);
      return response;
    }

    if (signal.type === "tool") {
      await Promise.resolve();
      const calls = this.#broker.listForTurn(session.threadId, session.turnId);
      if (calls.some((call) => !session.declaredTools.has(call.tool))) {
        await this.#abortSession(session);
        return failedResponse(responseId, session.model, "undeclared_client_tool");
      }
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
      const response = failedResponse(responseId, session.model, "upstream_turn_failed");
      this.#removeSession(session);
      return response;
    }

    const response = createGatewayResponse({
      id: responseId,
      model: session.model,
      output: [
        {
          type: "message",
          id: session.streamItemId ?? publicId("msg_myt"),
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: session.text, annotations: [] }],
        },
      ],
      usage: session.usage,
    });
    this.#removeSession(session);
    return response;
  }

  #nextStreamSignal(session: ActiveSession, signal?: AbortSignal): Promise<SessionSignal> {
    const queued = session.streamQueue.shift();
    if (queued) {
      session.streamQueuedBytes = Math.max(0, session.streamQueuedBytes - signalBytes(queued));
      return Promise.resolve(queued);
    }
    if (signal?.aborted) {
      return Promise.reject(new MyTokenError("client_disconnected", "Client disconnected"));
    }
    const deferred = new Deferred<SessionSignal>();
    session.streamWaiter = deferred;
    const timer = setTimeout(() => {
      if (session.streamWaiter !== deferred) return;
      session.streamWaiter = undefined;
      deferred.reject(new MyTokenError("response_timeout", "Timed out waiting for app-server"));
    }, this.#responseTimeoutMs);
    const abort = () => {
      if (session.streamWaiter === deferred) session.streamWaiter = undefined;
      deferred.reject(new MyTokenError("client_disconnected", "Client disconnected"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    return deferred.promise.finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
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
    if (signal.type === "delta") {
      if (!session.streaming) return;
      const streamWaiter = session.streamWaiter;
      if (streamWaiter) {
        session.streamWaiter = undefined;
        streamWaiter.resolve(signal);
      } else {
        this.#queueStreamSignal(session, signal);
      }
      return;
    }
    const waiter = session.waiter;
    if (waiter) {
      session.waiter = undefined;
      waiter.resolve(signal);
    } else {
      session.signals.push(signal);
    }
    if (!session.streaming) return;
    const streamWaiter = session.streamWaiter;
    if (streamWaiter) {
      session.streamWaiter = undefined;
      streamWaiter.resolve(signal);
    } else {
      this.#queueStreamSignal(session, signal);
    }
  }

  #queueStreamSignal(session: ActiveSession, signal: SessionSignal): void {
    const bytes = signalBytes(signal);
    if (session.streamQueue.length >= 64 || session.streamQueuedBytes + bytes > 1024 * 1024) {
      session.streamQueue.length = 0;
      session.streamQueuedBytes = 0;
      session.streamQueue.push({ type: "security", itemType: "streamOverflow" });
      void this.#interrupt(session);
      return;
    }
    session.streamQueue.push(signal);
    session.streamQueuedBytes += bytes;
  }

  #queueOrSignal(key: string, signal: SessionSignal): void {
    const session = this.#sessionsByTurn.get(key);
    if (session) {
      this.#signal(session, signal);
      return;
    }
    const signals = this.#orphanSignals.get(key) ?? [];
    signals.push(signal);
    this.#orphanSignals.set(key, signals);
  }

  #onAgentDelta(params: unknown): void {
    if (!isRecord(params)) return;
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    const delta = stringValue(params.delta);
    if (!threadId || !turnId || delta === undefined) return;
    const key = turnKey(threadId, turnId);
    const session = this.#sessionsByTurn.get(key);
    if (session) {
      session.text += delta;
      this.#signal(session, { type: "delta", delta });
    } else this.#orphanText.set(key, `${this.#orphanText.get(key) ?? ""}${delta}`);
  }

  #onTurnCompleted(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.turn)) return;
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turn.id);
    if (!threadId || !turnId) return;
    this.#queueOrSignal(turnKey(threadId, turnId), {
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
    this.#queueOrSignal(turnKey(threadId, turnId), { type: "security", itemType });
  }

  #onTokenUsage(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.tokenUsage) || !isRecord(params.tokenUsage.last)) {
      return;
    }
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    if (!threadId || !turnId) return;
    const last = params.tokenUsage.last;
    const input = numberValue(last.inputTokens);
    const output = numberValue(last.outputTokens);
    const total = numberValue(last.totalTokens);
    if (input === undefined || output === undefined || total === undefined) return;
    const session = this.#sessionsByTurn.get(turnKey(threadId, turnId));
    if (session)
      session.usage = { input_tokens: input, output_tokens: output, total_tokens: total };
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

  async #abortSession(session: ActiveSession): Promise<void> {
    const waiter = session.waiter;
    if (waiter) {
      session.waiter = undefined;
      waiter.reject(new MyTokenError("session_aborted", "Gateway session was aborted"));
    }
    const streamWaiter = session.streamWaiter;
    if (streamWaiter) {
      session.streamWaiter = undefined;
      streamWaiter.reject(new MyTokenError("session_aborted", "Gateway stream was aborted"));
    }
    await this.#interrupt(session);
    for (const call of this.#broker.listForTurn(session.threadId, session.turnId)) {
      this.#broker.fail(
        call.callId,
        session.generation,
        "Gateway request ended before completion.",
      );
    }
    this.#removeSession(session);
  }

  #removeSession(session: ActiveSession): void {
    this.#sessionsByTurn.delete(turnKey(session.threadId, session.turnId));
    for (const responseId of session.responseIds) this.#sessionsByResponse.delete(responseId);
    session.responseIds.clear();
    session.streamQueue.length = 0;
    session.streamQueuedBytes = 0;
    const key = turnKey(session.threadId, session.turnId);
    this.#orphanSignals.delete(key);
    this.#orphanText.delete(key);
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function signalBytes(signal: SessionSignal): number {
  if (signal.type === "delta") return Buffer.byteLength(signal.delta, "utf8");
  return Buffer.byteLength(JSON.stringify(signal), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
