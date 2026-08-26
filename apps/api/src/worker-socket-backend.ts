import http from "node:http";

import type { CreateResponseRequest, GatewayResponse } from "@mytoken/openai-compat";
import { MyTokenError } from "@mytoken/shared";

import type { GatewayBackend, GatewayModel, GatewayStreamEvent } from "./app.js";

export interface WorkerSocketBackendOptions {
  socketPath: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export class WorkerSocketBackend implements GatewayBackend {
  readonly #socketPath: string;
  readonly #requestTimeoutMs: number;
  readonly #maxResponseBytes: number;
  #ready = false;

  constructor(options: WorkerSocketBackendOptions) {
    this.#socketPath = options.socketPath;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  }

  isReady(): boolean {
    return this.#ready;
  }

  async probe(): Promise<boolean> {
    try {
      const health = await this.#request("GET", "/internal/health");
      this.#ready = isRecord(health) && health.status === "ready";
    } catch {
      this.#ready = false;
    }
    return this.#ready;
  }

  async listModels(): Promise<readonly GatewayModel[]> {
    const response = await this.#request("GET", "/internal/models");
    if (!isRecord(response) || !Array.isArray(response.data)) {
      throw new MyTokenError("invalid_worker_response", "Worker returned an invalid model list");
    }
    return response.data.flatMap((model) => {
      if (!isRecord(model) || typeof model.id !== "string") return [];
      return [
        {
          id: model.id,
          displayName: typeof model.displayName === "string" ? model.displayName : model.id,
        },
      ];
    });
  }

  async createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
  ): Promise<GatewayResponse> {
    return (await this.#request(
      "POST",
      "/internal/responses",
      {
        request,
        apiKeyId: context.apiKeyId,
      },
      context.signal,
    )) as GatewayResponse;
  }

  async createResponseStream(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
    emit: (event: GatewayStreamEvent) => Promise<void> | void,
  ): Promise<void> {
    await this.#streamRequest(
      "/internal/responses/stream",
      { request, apiKeyId: context.apiKeyId },
      context.signal,
      emit,
    );
  }

  account(): Promise<unknown> {
    return this.#request("GET", "/internal/account");
  }

  rateLimits(): Promise<unknown> {
    return this.#request("GET", "/internal/account/rate-limits");
  }

  usage(): Promise<unknown> {
    return this.#request("GET", "/internal/account/usage");
  }

  startDeviceLogin(): Promise<unknown> {
    return this.#request("POST", "/internal/account/login/device/start", {});
  }

  cancelDeviceLogin(loginId: string): Promise<unknown> {
    return this.#request("POST", "/internal/account/login/cancel", { loginId });
  }

  logoutAccount(): Promise<unknown> {
    return this.#request("POST", "/internal/account/logout", {});
  }

  #request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.#socketPath,
          path,
          method,
          headers:
            payload === undefined
              ? undefined
              : {
                  "content-type": "application/json",
                  "content-length": payload.byteLength,
                },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > this.#maxResponseBytes) {
              request.destroy(
                new MyTokenError("worker_response_too_large", "Worker response exceeded limit"),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if ((response.statusCode ?? 500) >= 400) {
              const parsed = parseWorkerError(text);
              reject(
                new WorkerRequestError(response.statusCode ?? 500, parsed.code, parsed.message),
              );
              return;
            }
            try {
              resolve(text.length === 0 ? {} : (JSON.parse(text) as unknown));
            } catch (error) {
              reject(
                new MyTokenError("invalid_worker_json", "Worker returned invalid JSON", error),
              );
            }
          });
        },
      );
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new MyTokenError("worker_timeout", "Worker request timed out"));
      });
      const abort = () =>
        request.destroy(new MyTokenError("client_disconnected", "Client disconnected"));
      request.on("error", (error) => {
        this.#ready = false;
        reject(error);
      });
      request.on("close", () => signal?.removeEventListener("abort", abort));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      if (payload) request.write(payload);
      request.end();
    });
  }

  #streamRequest(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    emit: (event: GatewayStreamEvent) => Promise<void> | void,
  ): Promise<void> {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    return new Promise((resolve, reject) => {
      let emitChain: Promise<void> = Promise.resolve();
      const request = http.request(
        {
          socketPath: this.#socketPath,
          path,
          method: "POST",
          headers: { "content-type": "application/json", "content-length": payload.byteLength },
        },
        (response) => {
          let buffer = "";
          let bytes = 0;
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            bytes += Buffer.byteLength(chunk, "utf8");
            if (bytes > this.#maxResponseBytes) {
              request.destroy(
                new MyTokenError("worker_response_too_large", "Worker response exceeded limit"),
              );
              return;
            }
            buffer += chunk;
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (line.length > 0) {
                if (Buffer.byteLength(line, "utf8") > 256 * 1024) {
                  request.destroy(
                    new MyTokenError(
                      "worker_stream_event_too_large",
                      "Worker stream event exceeded limit",
                    ),
                  );
                  return;
                }
                try {
                  const event = JSON.parse(line) as unknown;
                  if (isRecord(event) && typeof event.type === "string") {
                    emitChain = emitChain.then(async () => {
                      await emit(event as GatewayStreamEvent);
                      if (event.type === "response.error") {
                        const details = isRecord(event.error) ? event.error : {};
                        throw new MyTokenError(
                          typeof details.code === "string" ? details.code : "worker_stream_error",
                          typeof details.message === "string"
                            ? details.message
                            : "Worker stream failed",
                        );
                      }
                    });
                    emitChain.catch(reject);
                  }
                } catch {
                  request.destroy(
                    new MyTokenError("invalid_worker_json", "Worker returned invalid stream JSON"),
                  );
                  return;
                }
              }
              newline = buffer.indexOf("\n");
            }
          });
          response.on("end", () => {
            if (buffer.trim().length > 0) {
              reject(
                new MyTokenError(
                  "invalid_worker_json",
                  "Worker returned an incomplete stream event",
                ),
              );
              return;
            }
            if ((response.statusCode ?? 500) >= 400) {
              reject(
                new WorkerRequestError(
                  response.statusCode ?? 500,
                  "worker_request_failed",
                  "Worker rejected the request",
                ),
              );
              return;
            }
            emitChain.then(resolve, reject);
          });
        },
      );
      request.setTimeout(this.#requestTimeoutMs, () =>
        request.destroy(new MyTokenError("worker_timeout", "Worker request timed out")),
      );
      const abort = () =>
        request.destroy(new MyTokenError("client_disconnected", "Client disconnected"));
      request.on("error", (error) => {
        this.#ready = false;
        reject(error);
      });
      request.on("close", () => signal?.removeEventListener("abort", abort));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      request.write(payload);
      request.end();
    });
  }
}

class WorkerRequestError extends MyTokenError {
  constructor(
    readonly statusCode: number,
    code: string,
    message: string,
  ) {
    super(code, message);
    this.name = "WorkerRequestError";
  }
}

function parseWorkerError(text: string): { code: string; message: string } {
  try {
    const body = JSON.parse(text) as unknown;
    if (isRecord(body) && isRecord(body.error)) {
      return {
        code: typeof body.error.code === "string" ? body.error.code : "worker_request_failed",
        message:
          typeof body.error.message === "string"
            ? body.error.message
            : "Worker rejected the request",
      };
    }
  } catch {
    // Fall through to a stable redacted error.
  }
  return { code: "worker_request_failed", message: "Worker rejected the request" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
