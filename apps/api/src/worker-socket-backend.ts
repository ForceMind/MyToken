import http from "node:http";

import type { CreateResponseRequest, GatewayResponse } from "@mytoken/openai-compat";
import { MyTokenError } from "@mytoken/shared";

import type { GatewayBackend, GatewayModel } from "./app.js";

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
    context: { apiKeyId: string },
  ): Promise<GatewayResponse> {
    return (await this.#request("POST", "/internal/responses", {
      request,
      apiKeyId: context.apiKeyId,
    })) as GatewayResponse;
  }

  account(): Promise<unknown> {
    return this.#request("GET", "/internal/account");
  }

  rateLimits(): Promise<unknown> {
    return this.#request("GET", "/internal/account/rate-limits");
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

  #request(method: string, path: string, body?: unknown): Promise<unknown> {
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
              reject(
                new MyTokenError(
                  "worker_request_failed",
                  `Worker request failed with status ${String(response.statusCode)}`,
                ),
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
      request.on("error", (error) => {
        this.#ready = false;
        reject(error);
      });
      if (payload) request.write(payload);
      request.end();
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
