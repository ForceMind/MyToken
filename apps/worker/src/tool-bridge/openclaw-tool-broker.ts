import { EventEmitter } from "node:events";

import {
  dynamicToolCallParamsSchema,
  dynamicToolCallResponseSchema,
  type DynamicToolCallParams,
  type DynamicToolCallResponse,
  type JsonRpcId,
} from "@mytoken/contracts";
import { Deferred, MyTokenError } from "@mytoken/shared";

import type { CodexAppServerClient, ServerRequestContext } from "../app-server/client.js";

export interface ToolCallEvent extends DynamicToolCallParams {
  generation: number;
  rpcRequestId: JsonRpcId;
  expiresAt: number;
}

interface PendingToolCall {
  event: ToolCallEvent;
  deferred: Deferred<DynamicToolCallResponse>;
  timer: ReturnType<typeof setTimeout>;
}

export interface OpenClawToolBrokerOptions {
  resultTimeoutMs?: number;
  maxPendingCalls?: number;
  maxResultBytes?: number;
}

export class OpenClawToolBroker extends EventEmitter {
  readonly #resultTimeoutMs: number;
  readonly #maxPendingCalls: number;
  readonly #maxResultBytes: number;
  readonly #pending = new Map<string, PendingToolCall>();

  constructor(options: OpenClawToolBrokerOptions = {}) {
    super();
    this.#resultTimeoutMs = options.resultTimeoutMs ?? 5 * 60_000;
    this.#maxPendingCalls = options.maxPendingCalls ?? 8;
    this.#maxResultBytes = options.maxResultBytes ?? 1024 * 1024;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  attach(client: CodexAppServerClient): void {
    client.registerServerRequestHandler("item/tool/call", async (params, context) =>
      this.handle(params, context),
    );
  }

  handle(params: unknown, context: ServerRequestContext): Promise<DynamicToolCallResponse> {
    const parsed = dynamicToolCallParamsSchema.parse(params);
    if (this.#pending.size >= this.#maxPendingCalls) {
      return Promise.reject(
        new MyTokenError("too_many_pending_tool_calls", "Pending tool-call limit reached"),
      );
    }
    if (this.#pending.has(parsed.callId)) {
      return Promise.reject(
        new MyTokenError("duplicate_tool_call_id", "Duplicate dynamic tool call id"),
      );
    }

    const deferred = new Deferred<DynamicToolCallResponse>();
    const event: ToolCallEvent = {
      ...parsed,
      generation: context.generation,
      rpcRequestId: context.requestId,
      expiresAt: Date.now() + this.#resultTimeoutMs,
    };
    const timer = setTimeout(() => {
      const current = this.#pending.get(parsed.callId);
      if (!current) return;
      this.#pending.delete(parsed.callId);
      current.deferred.resolve({
        success: false,
        contentItems: [{ type: "inputText", text: "Client tool result timed out." }],
      });
      this.emit("expired", current.event);
    }, this.#resultTimeoutMs);

    this.#pending.set(parsed.callId, { event, deferred, timer });
    this.emit("toolCall", event);
    return deferred.promise;
  }

  get(callId: string): ToolCallEvent | undefined {
    return this.#pending.get(callId)?.event;
  }

  listForTurn(threadId: string, turnId: string): ToolCallEvent[] {
    return [...this.#pending.values()]
      .map((pending) => pending.event)
      .filter((event) => event.threadId === threadId && event.turnId === turnId);
  }

  resolve(callId: string, generation: number, response: DynamicToolCallResponse): ToolCallEvent {
    const pending = this.#pending.get(callId);
    if (!pending) {
      throw new MyTokenError("unknown_tool_call", "Tool call is not pending");
    }
    if (pending.event.generation !== generation) {
      throw new MyTokenError(
        "stale_tool_generation",
        "Tool call belongs to an old worker generation",
      );
    }

    const validated = dynamicToolCallResponseSchema.parse(response);
    const encodedBytes = Buffer.byteLength(JSON.stringify(validated), "utf8");
    if (encodedBytes > this.#maxResultBytes) {
      throw new MyTokenError("tool_result_too_large", "Tool result exceeds the configured limit");
    }

    clearTimeout(pending.timer);
    this.#pending.delete(callId);
    pending.deferred.resolve(validated);
    this.emit("resolved", pending.event);
    return pending.event;
  }

  fail(callId: string, generation: number, safeMessage: string): ToolCallEvent {
    return this.resolve(callId, generation, {
      success: false,
      contentItems: [{ type: "inputText", text: safeMessage.slice(0, 4096) }],
    });
  }

  invalidateGeneration(generation: number, reason = "Worker generation ended."): number {
    let invalidated = 0;
    for (const [callId, pending] of this.#pending) {
      if (pending.event.generation !== generation) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(callId);
      pending.deferred.resolve({
        success: false,
        contentItems: [{ type: "inputText", text: reason.slice(0, 4096) }],
      });
      invalidated += 1;
      this.emit("invalidated", pending.event);
    }
    return invalidated;
  }
}
