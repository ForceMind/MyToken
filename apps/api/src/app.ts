import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { AdminAuthService } from "@mytoken/admin-auth";
import { parseMyTokenKey, verifyMyTokenKey, type MyTokenKeyRecord } from "@mytoken/key-auth";
import {
  createResponseRequestSchema,
  openAiError,
  type CreateResponseRequest,
  type GatewayResponse,
  type ResponseFunctionCallItem,
  type ResponseMessageItem,
} from "@mytoken/openai-compat";

import {
  registerAdminRoutes,
  type ApiKeyManagementStore,
  type CodexAdminBackend,
} from "./admin-routes.js";

export interface GatewayModel {
  id: string;
  displayName: string;
  created?: number;
}

export interface GatewayBackend {
  isReady(): boolean;
  listModels(): Promise<readonly GatewayModel[]>;
  createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string },
  ): Promise<GatewayResponse>;
}

export interface ApiKeyStore {
  getById(keyId: string): Promise<MyTokenKeyRecord | undefined>;
}

export interface CreateApiAppOptions {
  backend: GatewayBackend;
  keyStore: ApiKeyStore;
  keyPepper: Uint8Array;
  adminAuth?: AdminAuthService;
  keyManagementStore?: ApiKeyManagementStore;
  codexAdminBackend?: CodexAdminBackend;
  cookieSecure?: boolean;
  staticRoot?: string;
  logger?: boolean;
}

interface AuthenticatedKey {
  plaintext: string;
  record: MyTokenKeyRecord;
}

export async function createApiApp(options: CreateApiAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    routerOptions: { ignoreTrailingSlash: false },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: "1 minute",
  });
  app.setErrorHandler((error, _request, reply) => {
    const candidate = isRecord(error) ? error.statusCode : undefined;
    const status = typeof candidate === "number" && candidate >= 400 ? candidate : 500;
    if (status === 429) {
      sendError(reply, 429, "Rate limit exceeded", "rate_limit_exceeded", "rate_limit_error");
      return;
    }
    if (status >= 500) {
      sendError(reply, 500, "Internal gateway error", "internal_error", "api_error");
      return;
    }
    sendError(reply, status, "Request was rejected", "request_rejected");
  });

  if (options.adminAuth && options.keyManagementStore) {
    registerAdminRoutes(app, {
      adminAuth: options.adminAuth,
      keyStore: options.keyManagementStore,
      keyPepper: options.keyPepper,
      cookieSecure: options.cookieSecure ?? true,
      ...(options.codexAdminBackend ? { codexBackend: options.codexAdminBackend } : {}),
    });
  }

  if (options.staticRoot) {
    await app.register(staticFiles, {
      root: options.staticRoot,
      prefix: "/",
      wildcard: false,
      cacheControl: true,
      maxAge: "1h",
      immutable: false,
    });
  }

  app.get("/healthz", () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    if (!options.backend.isReady()) {
      return reply.code(503).send({ status: "not_ready" });
    }
    return { status: "ready" };
  });

  app.get("/v1/models", async (request, reply) => {
    const authenticated = await authenticate(request, reply, options);
    if (!authenticated) return;
    if (!options.backend.isReady()) {
      return sendError(reply, 503, "Gateway is not ready", "gateway_not_ready", "api_error");
    }

    const allowed = new Set(authenticated.record.allowedModels);
    const models = (await options.backend.listModels()).filter(
      (model) => allowed.size === 0 || allowed.has(model.id),
    );
    return {
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: model.created ?? 0,
        owned_by: "mytoken",
      })),
    };
  });

  app.post("/v1/responses", async (request, reply) => {
    const authenticated = await authenticate(request, reply, options);
    if (!authenticated) return;
    if (!options.backend.isReady()) {
      return sendError(reply, 503, "Gateway is not ready", "gateway_not_ready", "api_error");
    }

    const parsed = createResponseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        "Request does not match the supported Responses API subset",
        "invalid_request",
      );
    }
    const body = parsed.data;
    if (
      authenticated.record.allowedModels.length > 0 &&
      !authenticated.record.allowedModels.includes(body.model)
    ) {
      return sendError(reply, 403, "Model is not allowed for this key", "model_not_allowed");
    }
    if ((body.tools?.length ?? 0) > 0 && !authenticated.record.allowClientTools) {
      return sendError(
        reply,
        403,
        "Client-defined tools are not allowed for this key",
        "client_tools_not_allowed",
        "invalid_request_error",
        "tools",
      );
    }

    const response = await options.backend.createResponse(body, {
      apiKeyId: authenticated.record.id,
    });
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", request.id);

    if (body.stream === true) {
      reply.header("Content-Type", "text/event-stream; charset=utf-8");
      reply.header("Cache-Control", "no-cache, no-transform");
      reply.header("X-Accel-Buffering", "no");
      return reply.send(encodeResponseSse(response));
    }
    return reply.send(response);
  });

  if (options.staticRoot) {
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        !request.url.startsWith("/v1/")
      ) {
        reply.header("Cache-Control", "no-cache");
        return reply.sendFile("index.html");
      }
      return sendError(reply, 404, "Route was not found", "not_found");
    });
  }

  return app;
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  options: CreateApiAppOptions,
): Promise<AuthenticatedKey | undefined> {
  const authorization = request.headers.authorization;
  const plaintext = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const parsed = plaintext ? parseMyTokenKey(plaintext) : null;
  const record = parsed ? await options.keyStore.getById(parsed.keyId) : undefined;
  if (!plaintext || !record || !verifyMyTokenKey(options.keyPepper, plaintext, record)) {
    await sendError(reply, 401, "Invalid authentication credentials", "invalid_api_key");
    return undefined;
  }
  return { plaintext, record };
}

function sendError(
  reply: FastifyReply,
  status: number,
  message: string,
  code: string,
  type = "invalid_request_error",
  param: string | null = null,
): FastifyReply {
  reply.header("Cache-Control", "no-store");
  return reply.code(status).send(openAiError(message, code, type, param));
}

export function encodeResponseSse(response: GatewayResponse): string {
  const events: Array<{ type: string; [key: string]: unknown }> = [
    { type: "response.created", response: { ...response, output: [] } },
  ];

  response.output.forEach((item, outputIndex) => {
    events.push({ type: "response.output_item.added", output_index: outputIndex, item });
    if (item.type === "message") appendMessageEvents(events, item, outputIndex);
    else appendFunctionCallEvents(events, item, outputIndex);
    events.push({ type: "response.output_item.done", output_index: outputIndex, item });
  });
  events.push({ type: "response.completed", response });
  return `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n`).join("\n")}\n`;
}

function appendMessageEvents(
  events: Array<{ type: string; [key: string]: unknown }>,
  item: ResponseMessageItem,
  outputIndex: number,
): void {
  item.content.forEach((content, contentIndex) => {
    events.push({
      type: "response.content_part.added",
      item_id: item.id,
      output_index: outputIndex,
      content_index: contentIndex,
      part: { ...content, text: "" },
    });
    events.push({
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: outputIndex,
      content_index: contentIndex,
      delta: content.text,
    });
  });
}

function appendFunctionCallEvents(
  events: Array<{ type: string; [key: string]: unknown }>,
  item: ResponseFunctionCallItem,
  outputIndex: number,
): void {
  events.push({
    type: "response.function_call_arguments.delta",
    item_id: item.id,
    call_id: item.call_id,
    output_index: outputIndex,
    delta: item.arguments,
  });
  events.push({
    type: "response.function_call_arguments.done",
    item_id: item.id,
    call_id: item.call_id,
    output_index: outputIndex,
    arguments: item.arguments,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
