import Fastify, { type FastifyInstance } from "fastify";

import { createResponseRequestSchema, openAiError } from "@mytoken/openai-compat";
import { MyTokenError } from "@mytoken/shared";

import type { CodexAppServerClient } from "./app-server/client.js";
import type { CodexResponseCoordinator } from "./gateway/codex-response-coordinator.js";

export interface CreateWorkerInternalAppOptions {
  client: CodexAppServerClient;
  coordinator: CodexResponseCoordinator;
  version: string;
}

export function createWorkerInternalApp(options: CreateWorkerInternalAppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, trustProxy: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MyTokenError) {
      return reply
        .code(internalStatus(error.code))
        .send(openAiError(error.message, error.code, "api_error"));
    }
    return reply.code(500).send(openAiError("Internal worker error", "internal_worker_error"));
  });

  app.get("/internal/health", () => ({
    status: options.client.state,
    generation: options.client.generation,
    version: options.version,
  }));

  app.get("/internal/account", async () =>
    options.client.request("account/read", { refreshToken: false }),
  );

  app.post("/internal/account/login/device/start", async () =>
    options.client.request("account/login/start", { type: "chatgptDeviceCode" }),
  );

  app.post("/internal/account/login/cancel", async (request, reply) => {
    if (!isRecord(request.body) || typeof request.body.loginId !== "string") {
      return reply.code(400).send(openAiError("loginId is required", "invalid_request"));
    }
    return options.client.request("account/login/cancel", { loginId: request.body.loginId });
  });

  app.post("/internal/account/logout", async () => options.client.request("account/logout"));

  app.get("/internal/account/rate-limits", async () =>
    options.client.request("account/rateLimits/read"),
  );

  app.get("/internal/account/usage", async () => options.client.request("account/usage/read"));

  app.get("/internal/models", async () => ({ data: await options.coordinator.listModels() }));

  app.post("/internal/responses", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const parsed = createResponseRequestSchema.safeParse(body.request);
    if (!parsed.success || typeof body.apiKeyId !== "string") {
      return reply
        .code(400)
        .send(openAiError("Invalid internal response request", "invalid_internal_request"));
    }
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort());
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    return options.coordinator.createResponse(parsed.data, {
      apiKeyId: body.apiKeyId,
      signal: controller.signal,
    });
  });

  app.post("/internal/responses/stream", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const parsed = createResponseRequestSchema.safeParse(body.request);
    if (!parsed.success || typeof body.apiKeyId !== "string") {
      return reply
        .code(400)
        .send(openAiError("Invalid internal response request", "invalid_internal_request"));
    }
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort());
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    const maxLineBytes = 256 * 1024;
    const write = async (event: unknown): Promise<void> => {
      const line = `${JSON.stringify(event)}\n`;
      if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
        throw new MyTokenError(
          "worker_stream_event_too_large",
          "Worker stream event exceeded limit",
        );
      }
      if (!reply.raw.write(line)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onClose = () => {
            cleanup();
            reject(new MyTokenError("client_disconnected", "Client disconnected"));
          };
          const cleanup = () => {
            reply.raw.off("drain", onDrain);
            reply.raw.off("close", onClose);
          };
          reply.raw.once("drain", onDrain);
          reply.raw.once("close", onClose);
        });
      }
    };
    try {
      await options.coordinator.createResponseStream(
        parsed.data,
        {
          apiKeyId: body.apiKeyId,
          signal: controller.signal,
        },
        write,
      );
    } catch (error) {
      if (!reply.raw.writableEnded && !controller.signal.aborted) {
        await write({
          type: "response.error",
          error: { code: errorCode(error), message: errorMessage(error) },
        });
      }
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.post("/internal/turns/:turnId/interrupt", async (request, reply) => {
    const params = request.params as { turnId?: string };
    const body = isRecord(request.body) ? request.body : {};
    if (!params.turnId || typeof body.threadId !== "string") {
      return reply.code(400).send(openAiError("threadId is required", "invalid_request"));
    }
    return options.client.request("turn/interrupt", {
      threadId: body.threadId,
      turnId: params.turnId,
    });
  });

  app.delete("/internal/threads/:threadId", async (request) => {
    const params = request.params as { threadId: string };
    return options.client.request("thread/delete", { threadId: params.threadId });
  });

  return app;
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "internal_worker_error";
}

function errorMessage(error: unknown): string {
  return error instanceof MyTokenError ? error.message : "Internal worker error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internalStatus(code: string): number {
  if (["response_not_found", "tool_call_not_found", "unknown_tool_call"].includes(code)) return 404;
  if (["worker_generation_changed", "response_already_waiting"].includes(code)) return 409;
  if (["response_timeout", "app_server_request_timeout"].includes(code)) return 504;
  if (code === "client_disconnected") return 408;
  return 400;
}
