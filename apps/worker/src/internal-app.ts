import Fastify, { type FastifyInstance } from "fastify";

import { createResponseRequestSchema, openAiError } from "@mytoken/openai-compat";

import type { CodexAppServerClient } from "./app-server/client.js";
import type { CodexResponseCoordinator } from "./gateway/codex-response-coordinator.js";

export interface CreateWorkerInternalAppOptions {
  client: CodexAppServerClient;
  coordinator: CodexResponseCoordinator;
  version: string;
}

export function createWorkerInternalApp(options: CreateWorkerInternalAppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, trustProxy: false });

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

  app.get("/internal/models", async () => ({ data: await options.coordinator.listModels() }));

  app.post("/internal/responses", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const parsed = createResponseRequestSchema.safeParse(body.request);
    if (!parsed.success || typeof body.apiKeyId !== "string") {
      return reply
        .code(400)
        .send(openAiError("Invalid internal response request", "invalid_internal_request"));
    }
    return options.coordinator.createResponse(parsed.data, { apiKeyId: body.apiKeyId });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
