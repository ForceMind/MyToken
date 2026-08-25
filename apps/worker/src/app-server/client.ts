import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { EventEmitter } from "node:events";

import type { JsonRpcId, WorkerState } from "@mytoken/contracts";
import { Deferred, MyTokenError, asError, redactText } from "@mytoken/shared";

interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface ServerRequestContext {
  requestId: JsonRpcId;
  generation: number;
}

export type ServerRequestHandler = (params: unknown, context: ServerRequestContext) => unknown;

export type NotificationHandler = (params: unknown) => void | Promise<void>;

export interface CodexAppServerClientOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  maxLineBytes?: number;
}

export interface InitializeOptions {
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
  experimentalApi?: boolean;
  optOutNotificationMethods?: readonly string[];
}

interface PendingRequest {
  deferred: Deferred<unknown>;
  timer: ReturnType<typeof setTimeout>;
  generation: number;
  method: string;
}

export class AppServerRpcError extends MyTokenError {
  constructor(
    readonly rpcCode: number | undefined,
    message: string,
    readonly data?: unknown,
  ) {
    super("app_server_rpc_error", message);
    this.name = "AppServerRpcError";
  }
}

export class CodexAppServerClient extends EventEmitter {
  readonly #options: Required<
    Pick<CodexAppServerClientOptions, "requestTimeoutMs" | "maxLineBytes">
  > &
    Omit<CodexAppServerClientOptions, "requestTimeoutMs" | "maxLineBytes">;

  #child: ChildProcessWithoutNullStreams | undefined;
  #nextRequestId = 1;
  #pending = new Map<JsonRpcId, PendingRequest>();
  #notificationHandlers = new Map<string, Set<NotificationHandler>>();
  #serverRequestHandlers = new Map<string, ServerRequestHandler>();
  #stdoutBuffer = Buffer.alloc(0);
  #stopping = false;
  #state: WorkerState = "stopped";
  #generation = 0;

  constructor(options: CodexAppServerClientOptions) {
    super();
    this.#options = {
      ...options,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      maxLineBytes: options.maxLineBytes ?? 4 * 1024 * 1024,
    };
  }

  get state(): WorkerState {
    return this.#state;
  }

  get generation(): number {
    return this.#generation;
  }

  registerServerRequestHandler(method: string, handler: ServerRequestHandler): void {
    if (this.#serverRequestHandlers.has(method)) {
      throw new MyTokenError(
        "duplicate_server_request_handler",
        `A handler is already registered for ${method}`,
      );
    }
    this.#serverRequestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): () => void {
    const handlers = this.#notificationHandlers.get(method) ?? new Set<NotificationHandler>();
    handlers.add(handler);
    this.#notificationHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#notificationHandlers.delete(method);
    };
  }

  async start(options: InitializeOptions): Promise<unknown> {
    if (this.#child) {
      throw new MyTokenError("app_server_already_started", "app-server is already started");
    }

    this.#stopping = false;
    this.#setState("starting");
    this.#generation += 1;
    const generation = this.#generation;

    const spawnOptions: SpawnOptionsWithoutStdio = {
      stdio: "pipe",
      shell: false,
    };
    if (this.#options.cwd !== undefined) spawnOptions.cwd = this.#options.cwd;
    if (this.#options.env !== undefined) spawnOptions.env = this.#options.env;

    const child = spawn(this.#options.command, [...(this.#options.args ?? [])], spawnOptions);
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.#onStdout(chunk, generation));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = redactText(chunk.toString("utf8")).slice(0, 16_384);
      this.emit("stderr", text);
    });
    child.once("error", (error) => this.#onChildFailure(error, generation));
    child.once("exit", (code, signal) => {
      this.#onChildFailure(
        new MyTokenError(
          "app_server_exited",
          `app-server exited (code=${String(code)}, signal=${String(signal)})`,
        ),
        generation,
      );
    });

    const capabilities: Record<string, unknown> = {};
    if (options.experimentalApi !== undefined) {
      capabilities.experimentalApi = options.experimentalApi;
    }
    if (options.optOutNotificationMethods !== undefined) {
      capabilities.optOutNotificationMethods = [...options.optOutNotificationMethods];
    }

    try {
      const initializeResult = await this.request("initialize", {
        clientInfo: options.clientInfo,
        ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
      });
      this.notify("initialized", {});
      this.#setState("ready");
      return initializeResult;
    } catch (error) {
      this.#setState("degraded");
      this.stop();
      throw error;
    }
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.#child || this.#child.killed) {
      return Promise.reject(
        new MyTokenError("app_server_not_running", "app-server is not running"),
      );
    }

    const id = this.#nextRequestId++;
    const deferred = new Deferred<unknown>();
    const effectiveTimeout = timeoutMs ?? this.#options.requestTimeoutMs;
    const timer = setTimeout(() => {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      pending.deferred.reject(
        new MyTokenError(
          "app_server_request_timeout",
          `app-server request ${pending.method} timed out`,
        ),
      );
    }, effectiveTimeout);

    this.#pending.set(id, {
      deferred,
      timer,
      generation: this.#generation,
      method,
    });

    try {
      this.#writeMessage(params === undefined ? { id, method } : { id, method, params });
    } catch (error) {
      clearTimeout(timer);
      this.#pending.delete(id);
      deferred.reject(error);
    }

    return deferred.promise as Promise<T>;
  }

  notify(method: string, params?: unknown): void {
    this.#writeMessage(params === undefined ? { method } : { method, params });
  }

  stop(): void {
    const child = this.#child;
    if (!child) {
      this.#setState("stopped");
      return;
    }

    this.#stopping = true;
    this.#child = undefined;
    this.#rejectAllPending(
      new MyTokenError("app_server_stopped", "app-server was stopped before responding"),
    );

    if (!child.killed) child.kill("SIGTERM");
    this.#stdoutBuffer = Buffer.alloc(0);
    this.#setState("stopped");
  }

  #writeMessage(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    const child = this.#child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new MyTokenError("app_server_not_writable", "app-server stdin is unavailable");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #onStdout(chunk: Buffer, generation: number): void {
    if (generation !== this.#generation) return;
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);
    if (
      this.#stdoutBuffer.byteLength > this.#options.maxLineBytes &&
      !this.#stdoutBuffer.includes(10)
    ) {
      this.#failProtocol(
        new MyTokenError("app_server_line_too_large", "app-server emitted an oversized line"),
      );
      return;
    }

    let newlineIndex = this.#stdoutBuffer.indexOf(10);
    while (newlineIndex >= 0) {
      const lineBuffer = this.#stdoutBuffer.subarray(0, newlineIndex);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newlineIndex + 1);
      if (lineBuffer.byteLength > this.#options.maxLineBytes) {
        this.#failProtocol(
          new MyTokenError("app_server_line_too_large", "app-server emitted an oversized line"),
        );
        return;
      }
      const line = lineBuffer.toString("utf8").trim();
      if (line.length > 0) this.#parseLine(line, generation);
      newlineIndex = this.#stdoutBuffer.indexOf(10);
    }
  }

  #parseLine(line: string, generation: number): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch (error) {
      this.#failProtocol(
        new MyTokenError("app_server_invalid_json", "app-server emitted invalid JSON", error),
      );
      return;
    }

    if (!isRecord(message)) {
      this.#failProtocol(
        new MyTokenError("app_server_invalid_message", "app-server message must be an object"),
      );
      return;
    }

    const hasId = typeof message.id === "string" || typeof message.id === "number";
    const hasMethod = typeof message.method === "string";

    if (hasId && hasMethod) {
      void this.#handleServerRequest(message as unknown as JsonRpcRequest, generation);
      return;
    }
    if (hasId) {
      this.#handleResponse(message as unknown as JsonRpcResponse, generation);
      return;
    }
    if (hasMethod) {
      this.#handleNotification(message as unknown as JsonRpcNotification);
      return;
    }

    this.#failProtocol(
      new MyTokenError("app_server_invalid_message", "app-server message has no id or method"),
    );
  }

  async #handleServerRequest(message: JsonRpcRequest, generation: number): Promise<void> {
    const handler = this.#serverRequestHandlers.get(message.method);
    if (!handler) {
      this.#writeMessage({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` },
      });
      return;
    }

    try {
      const result = await handler(message.params, {
        requestId: message.id,
        generation,
      });
      if (generation !== this.#generation) return;
      this.#writeMessage({ id: message.id, result });
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#writeMessage({
        id: message.id,
        error: {
          code: -32000,
          message: redactText(asError(error).message).slice(0, 1024),
        },
      });
    }
  }

  #handleResponse(message: JsonRpcResponse, generation: number): void {
    const pending = this.#pending.get(message.id);
    if (!pending) {
      this.emit("orphanResponse", message.id);
      return;
    }
    if (pending.generation !== generation) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);

    if (message.error) {
      pending.deferred.reject(
        new AppServerRpcError(
          message.error.code,
          message.error.message ?? "Unknown app-server RPC error",
          message.error.data,
        ),
      );
      return;
    }
    pending.deferred.resolve(message.result);
  }

  #handleNotification(message: JsonRpcNotification): void {
    const handlers = this.#notificationHandlers.get(message.method);
    if (!handlers) return;
    for (const handler of handlers) {
      void Promise.resolve(handler(message.params)).catch((error: unknown) => {
        this.emit("notificationHandlerError", message.method, asError(error));
      });
    }
  }

  #onChildFailure(error: Error, generation: number): void {
    if (generation !== this.#generation) return;
    this.#child = undefined;
    this.#stdoutBuffer = Buffer.alloc(0);
    this.#rejectAllPending(error);
    this.#setState(this.#stopping ? "stopped" : "degraded");
    if (!this.#stopping) this.emit("childFailure", error);
  }

  #failProtocol(error: Error): void {
    this.#setState("degraded");
    this.#rejectAllPending(error);
    this.emit("protocolError", error);
    const child = this.#child;
    this.#child = undefined;
    if (child && !child.killed) child.kill("SIGTERM");
  }

  #rejectAllPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.deferred.reject(error);
    }
    this.#pending.clear();
  }

  #setState(state: WorkerState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit("state", state);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
