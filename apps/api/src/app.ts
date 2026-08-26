import { randomBytes } from "node:crypto";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { AdminAuthService } from "@mytoken/admin-auth";
import { parseMyTokenKey, verifyMyTokenKey, type MyTokenKeyRecord } from "@mytoken/key-auth";
import { MyTokenError } from "@mytoken/shared";
import {
  chatCompletionRequestSchema,
  chatCompletionToResponse,
  createResponseRequestSchema,
  openAiError,
  type CreateResponseRequest,
  type GatewayResponse,
  type ResponseFunctionCallItem,
  type ResponseMessageItem,
  responseToChatCompletion,
} from "@mytoken/openai-compat";

import {
  registerAdminRoutes,
  type ApiKeyManagementStore,
  type CodexAdminBackend,
} from "./admin-routes.js";
import type { CodexImportService } from "./codex-import-service.js";
import type { ProviderManagementService } from "./provider-management-service.js";
import { PolicyError, type RequestPolicyManager } from "./request-policy.js";
import type { SystemUpdateService } from "./system-update-service.js";
import type { GatewayUsageStore } from "./usage-store.js";

export interface GatewayModel {
  id: string;
  displayName: string;
  created?: number;
  providerId?: string;
  providerName?: string;
  upstreamModel?: string;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

export interface GatewayProviderStatus {
  id: string;
  name: string;
  protocol: string;
  enabled: boolean;
  ready: boolean;
  modelsCount: number;
  error: string | null;
}

export interface GatewayBackend {
  isReady(): boolean;
  probe?(): Promise<boolean>;
  providerStatuses?(): Promise<readonly GatewayProviderStatus[]>;
  listModels(): Promise<readonly GatewayModel[]>;
  createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
  ): Promise<GatewayResponse>;
  createResponseStream?(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
    emit: (event: GatewayStreamEvent) => Promise<void> | void,
  ): Promise<void>;
}

export type GatewayStreamEvent =
  | { type: "response.created"; response: Record<string, unknown>; itemId?: string }
  | { type: "text.delta"; delta: string }
  | {
      type: "response.completed" | "response.tool_call" | "response.failed";
      response: GatewayResponse;
    }
  | { type: "response.error"; error: { code: string; message: string } };

export interface ApiKeyStore {
  getById(keyId: string): Promise<MyTokenKeyRecord | undefined>;
  touchLastUsed?(keyId: string, now?: number): void;
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
  usageStore?: GatewayUsageStore;
  policyManager?: RequestPolicyManager;
  trustProxy?: boolean | string | string[];
  systemUpdate?: SystemUpdateService;
  providerManagement?: ProviderManagementService;
  codexImport?: CodexImportService;
  /** Release identifier exposed by the diagnostic version endpoint. */
  version?: string;
}

interface AuthenticatedKey {
  plaintext: string;
  record: MyTokenKeyRecord;
}

export async function createApiApp(options: CreateApiAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: options.trustProxy ?? false,
    genReqId: () => `req_myt_${randomBytes(12).toString("base64url")}`,
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
    if (error instanceof PolicyError) {
      if (error.retryAfter !== undefined) reply.header("Retry-After", String(error.retryAfter));
      sendError(reply, error.statusCode, error.message, error.code, "rate_limit_error");
      return;
    }
    if (error instanceof MyTokenError) {
      const status = publicStatusForCode(error.code);
      sendError(
        reply,
        status,
        publicMessageForCode(error.code),
        error.code,
        status >= 500 ? "api_error" : "invalid_request_error",
      );
      return;
    }
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
      ...(options.usageStore ? { usageStore: options.usageStore } : {}),
      ...(options.policyManager ? { policyManager: options.policyManager } : {}),
      ...(options.systemUpdate ? { systemUpdate: options.systemUpdate } : {}),
      ...(options.providerManagement ? { providerManagement: options.providerManagement } : {}),
      ...(options.codexImport ? { codexImport: options.codexImport } : {}),
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
      setHeaders(response, filePath) {
        if (filePath.endsWith("index.html") || filePath.endsWith("version.json")) {
          response.header("Cache-Control", "no-store, no-cache, must-revalidate");
        }
      },
    });
  }

  app.get("/healthz", () => ({ status: "ok" }));
  app.get("/versionz", (_request, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return { status: "ok", version: options.version ?? "unknown" };
  });
  app.get("/readyz", async (_request, reply) => {
    if (!(await backendReady(options.backend))) {
      return reply.code(503).send({ status: "not_ready" });
    }
    return { status: "ready" };
  });

  app.get("/v1/models", async (request, reply) => {
    const authenticated = await authenticate(request, reply, options);
    if (!authenticated) return;
    if (!(await backendReady(options.backend))) {
      return sendError(reply, 503, "Gateway is not ready", "gateway_not_ready", "api_error");
    }

    const allowed = new Set(authenticated.record.allowedModels);
    const listed = await executeLogged(
      request,
      authenticated,
      options,
      { billable: false, model: null, requestBody: null },
      () => options.backend.listModels(),
    );
    const models = listed.filter((model) => allowed.size === 0 || allowed.has(model.id));
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
    const disconnect = disconnectSignal(reply);
    const authenticated = await authenticate(request, reply, options);
    if (!authenticated) return;
    if (!(await backendReady(options.backend))) {
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

    if (body.stream === true && options.backend.createResponseStream) {
      return executeLoggedStream(request, reply, authenticated, options, body, disconnect);
    }
    const response = await executeLogged(
      request,
      authenticated,
      options,
      { billable: true, model: body.model, requestBody: body },
      () =>
        options.backend.createResponse(body, {
          apiKeyId: authenticated.record.id,
          signal: disconnect,
        }),
    );
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

  app.post("/v1/chat/completions", async (request, reply) => {
    const disconnect = disconnectSignal(reply);
    const authenticated = await authenticate(request, reply, options);
    if (!authenticated) return;
    if (!(await backendReady(options.backend))) {
      return sendError(reply, 503, "Gateway is not ready", "gateway_not_ready", "api_error");
    }
    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        "Request does not match the text-only Chat Completions subset",
        "unsupported_chat_completion_request",
      );
    }
    if (
      authenticated.record.allowedModels.length > 0 &&
      !authenticated.record.allowedModels.includes(parsed.data.model)
    ) {
      return sendError(reply, 403, "Model is not allowed for this key", "model_not_allowed");
    }
    if (parsed.data.stream === true && options.backend.createResponseStream) {
      return executeLoggedStream(
        request,
        reply,
        authenticated,
        options,
        chatCompletionToResponse(parsed.data),
        disconnect,
        "chat",
        parsed.data,
      );
    }
    const response = await executeLogged(
      request,
      authenticated,
      options,
      { billable: true, model: parsed.data.model, requestBody: parsed.data },
      () =>
        options.backend.createResponse(chatCompletionToResponse(parsed.data), {
          apiKeyId: authenticated.record.id,
          signal: disconnect,
        }),
    );
    const completion = responseToChatCompletion(response);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", request.id);
    if (parsed.data.stream === true) {
      reply.header("Content-Type", "text/event-stream; charset=utf-8");
      reply.header("Cache-Control", "no-cache, no-transform");
      reply.header("X-Accel-Buffering", "no");
      return reply.send(encodeChatCompletionSse(completion));
    }
    return reply.send(completion);
  });

  if (options.staticRoot) {
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        !request.url.startsWith("/v1/")
      ) {
        reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
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

async function executeLogged<T>(
  request: FastifyRequest,
  authenticated: AuthenticatedKey,
  options: CreateApiAppOptions,
  details: { billable: boolean; model: string | null; requestBody: unknown },
  operation: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const logId = randomBytes(16).toString("hex");
  const resolvedModel = resolveLogModel(details.model);
  let lease: { release(): void } | undefined;
  try {
    lease = options.policyManager?.acquire(authenticated.record, request.ip, details.billable);
  } catch (error) {
    if (options.usageStore) {
      options.usageStore.begin({
        id: logId,
        requestId: request.id,
        apiKeyId: authenticated.record.id,
        method: request.method,
        path: request.routeOptions.url ?? request.url,
        model: details.model,
        providerId: resolvedModel.providerId,
        upstreamModel: resolvedModel.upstreamModel,
        billable: false,
        startedAt: now,
        sourceIp: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        requestBody: details.requestBody,
      });
      options.usageStore.complete(logId, {
        statusCode: statusForError(error),
        status: "failed",
        completedAt: Date.now(),
        errorCode: codeForError(error),
        responseBody: { error: { code: codeForError(error) } },
      });
    }
    throw error;
  }

  options.keyStore.touchLastUsed?.(authenticated.record.id, now);
  options.usageStore?.begin({
    id: logId,
    requestId: request.id,
    apiKeyId: authenticated.record.id,
    method: request.method,
    path: request.routeOptions.url ?? request.url,
    model: details.model,
    providerId: resolvedModel.providerId,
    upstreamModel: resolvedModel.upstreamModel,
    billable: details.billable,
    startedAt: now,
    sourceIp: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
    requestBody: details.requestBody,
  });

  try {
    const result = await operation();
    const gateway = isGatewayResponse(result) ? result : undefined;
    options.usageStore?.complete(logId, {
      statusCode: 200,
      status: gateway?.status === "failed" ? "failed" : "completed",
      completedAt: Date.now(),
      inputTokens: gateway?.usage?.input_tokens ?? null,
      outputTokens: gateway?.usage?.output_tokens ?? null,
      totalTokens: gateway?.usage?.total_tokens ?? null,
      errorCode: gateway?.error?.code ?? null,
      responseBody: result,
    });
    return result;
  } catch (error) {
    options.usageStore?.complete(logId, {
      statusCode: statusForError(error),
      status: "failed",
      completedAt: Date.now(),
      errorCode: codeForError(error),
      responseBody: { error: { code: codeForError(error) } },
    });
    throw error;
  } finally {
    lease?.release();
  }
}

async function executeLoggedStream(
  request: FastifyRequest,
  reply: FastifyReply,
  authenticated: AuthenticatedKey,
  options: CreateApiAppOptions,
  body: CreateResponseRequest,
  signal: AbortSignal,
  format: "responses" | "chat" = "responses",
  requestBody: unknown = body,
): Promise<void> {
  if (!options.backend.createResponseStream) {
    throw new MyTokenError("streaming_not_supported", "Streaming is not supported");
  }
  const now = Date.now();
  const logId = randomBytes(16).toString("hex");
  let lease: { release(): void } | undefined;
  let hijacked = false;
  try {
    lease = options.policyManager?.acquire(authenticated.record, request.ip, true);
    options.keyStore.touchLastUsed?.(authenticated.record.id, now);
    options.usageStore?.begin({
      id: logId,
      requestId: request.id,
      apiKeyId: authenticated.record.id,
      method: request.method,
      path: request.routeOptions.url ?? request.url,
      model: body.model,
      providerId: resolveLogModel(body.model).providerId,
      upstreamModel: resolveLogModel(body.model).upstreamModel,
      billable: true,
      startedAt: now,
      sourceIp: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      requestBody,
    });
    reply.hijack();
    hijacked = true;
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    const write = async (event: GatewayStreamEvent): Promise<void> => {
      if (signal.aborted) throw new MyTokenError("client_disconnected", "Client disconnected");
      const encoded =
        format === "chat"
          ? encodeChatGatewayStreamEvent(event, streamState)
          : encodeGatewayStreamEvent(event, streamState);
      if (!reply.raw.write(encoded)) {
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
    const streamState: StreamEncodingState = {
      responseId: "",
      itemId: "",
      text: "",
      textStarted: false,
    };
    let finalResponse: GatewayResponse | undefined;
    await options.backend.createResponseStream(
      body,
      { apiKeyId: authenticated.record.id, signal },
      async (event) => {
        if ("response" in event && isGatewayResponse(event.response))
          finalResponse = event.response;
        await write(event);
      },
    );
    options.usageStore?.complete(logId, {
      statusCode: 200,
      status: finalResponse?.status === "failed" ? "failed" : "completed",
      completedAt: Date.now(),
      inputTokens: finalResponse?.usage?.input_tokens ?? null,
      outputTokens: finalResponse?.usage?.output_tokens ?? null,
      totalTokens: finalResponse?.usage?.total_tokens ?? null,
      errorCode: finalResponse?.error?.code ?? null,
      responseBody: finalResponse ?? null,
    });
  } catch (error) {
    options.usageStore?.complete(logId, {
      statusCode: statusForError(error),
      status: "failed",
      completedAt: Date.now(),
      errorCode: codeForError(error),
      responseBody: { error: { code: codeForError(error) } },
    });
    if (!hijacked) throw error;
    if (!reply.raw.writableEnded && !signal.aborted) {
      const message = error instanceof MyTokenError ? error.message : "Internal gateway error";
      reply.raw.write(
        `event: response.error\ndata: ${JSON.stringify({ type: "response.error", error: { code: codeForError(error), message } })}\n\n`,
      );
      reply.raw.end();
    }
  } finally {
    lease?.release();
    if (!reply.raw.writableEnded && !signal.aborted) reply.raw.end();
  }
}

interface StreamEncodingState {
  responseId: string;
  itemId: string;
  text: string;
  textStarted: boolean;
}

function encodeGatewayStreamEvent(event: GatewayStreamEvent, state: StreamEncodingState): string {
  if (event.type === "response.created") {
    state.responseId = typeof event.response.id === "string" ? event.response.id : "";
    state.itemId = event.itemId ?? `msg_myt_${randomBytes(12).toString("base64url")}`;
    return sseEvent("response.created", { type: "response.created", response: event.response });
  }
  if (event.type === "text.delta") {
    state.text += event.delta;
    const prefix = state.textStarted ? "" : startTextItem(state);
    state.textStarted = true;
    return `${prefix}${sseEvent("response.output_text.delta", {
      type: "response.output_text.delta",
      response_id: state.responseId,
      item_id: state.itemId,
      output_index: 0,
      content_index: 0,
      delta: event.delta,
    })}`;
  }
  if (event.type === "response.tool_call") {
    return encodeFinalToolEvents(event.response);
  }
  if (event.type === "response.completed") {
    const prefix = state.textStarted ? "" : startTextItem(state);
    return `${prefix}${sseEvent("response.output_text.done", {
      type: "response.output_text.done",
      response_id: state.responseId,
      item_id: state.itemId,
      output_index: 0,
      content_index: 0,
      text: state.text,
    })}${sseEvent("response.content_part.done", {
      type: "response.content_part.done",
      response_id: state.responseId,
      item_id: state.itemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: state.text, annotations: [] },
    })}${sseEvent("response.output_item.done", {
      type: "response.output_item.done",
      response_id: state.responseId,
      output_index: 0,
      item: event.response.output[0],
    })}${sseEvent("response.completed", { type: "response.completed", response: event.response })}`;
  }
  if (event.type === "response.failed") {
    return sseEvent("response.failed", { type: "response.failed", response: event.response });
  }
  return sseEvent("response.error", event);
}

function encodeChatGatewayStreamEvent(
  event: GatewayStreamEvent,
  state: StreamEncodingState,
): string {
  if (event.type === "response.created") {
    state.responseId =
      typeof event.response.id === "string"
        ? `chatcmpl_myt_${event.response.id.replace(/^resp_myt_/u, "")}`
        : `chatcmpl_myt_${randomBytes(12).toString("base64url")}`;
    return chatSseChunk(state.responseId, event.response.model, { role: "assistant" }, null);
  }
  if (event.type === "text.delta") {
    state.text += event.delta;
    return chatSseChunk(state.responseId, undefined, { content: event.delta }, null);
  }
  if (event.type === "response.completed") {
    return `${chatSseChunk(state.responseId, event.response.model, {}, "stop", event.response.usage)}data: [DONE]\n\n`;
  }
  if (event.type === "response.tool_call") {
    return `data: ${JSON.stringify({ error: { code: "chat_stream_tools_unsupported", message: "Streaming tool calls require the Responses API" } })}\n\ndata: [DONE]\n\n`;
  }
  return `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`;
}

function chatSseChunk(
  id: string,
  model: unknown,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: GatewayResponse["usage"],
): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    ...(typeof model === "string" ? { model } : {}),
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage !== undefined ? { usage } : {}),
  })}\n\n`;
}

function startTextItem(state: StreamEncodingState): string {
  return `${sseEvent("response.output_item.added", {
    type: "response.output_item.added",
    response_id: state.responseId,
    output_index: 0,
    item: {
      id: state.itemId,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [],
    },
  })}${sseEvent("response.content_part.added", {
    type: "response.content_part.added",
    response_id: state.responseId,
    item_id: state.itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  })}`;
}

function encodeFinalToolEvents(response: GatewayResponse): string {
  return (
    response.output
      .map((item, outputIndex) =>
        item.type === "function_call"
          ? `${sseEvent("response.output_item.added", {
              type: "response.output_item.added",
              response_id: response.id,
              output_index: outputIndex,
              item,
            })}${sseEvent("response.function_call_arguments.done", {
              type: "response.function_call_arguments.done",
              response_id: response.id,
              item_id: item.id,
              call_id: item.call_id,
              output_index: outputIndex,
              arguments: item.arguments,
            })}${sseEvent("response.output_item.done", {
              type: "response.output_item.done",
              response_id: response.id,
              output_index: outputIndex,
              item,
            })}`
          : "",
      )
      .join("") + sseEvent("response.completed", { type: "response.completed", response })
  );
}

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isGatewayResponse(value: unknown): value is GatewayResponse {
  return isRecord(value) && value.object === "response" && typeof value.id === "string";
}

function statusForError(error: unknown): number {
  if (error instanceof PolicyError) return error.statusCode;
  if (isRecord(error) && typeof error.statusCode === "number") return error.statusCode;
  if (isRecord(error) && error.code === "worker_timeout") return 504;
  return 500;
}

function codeForError(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "internal_error";
}

function disconnectSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once("close", () => {
    if (!reply.raw.writableEnded) controller.abort();
  });
  return controller.signal;
}

async function backendReady(backend: GatewayBackend): Promise<boolean> {
  return backend.probe ? backend.probe() : backend.isReady();
}

function resolveLogModel(model: string | null): {
  providerId: string;
  upstreamModel: string | null;
} {
  if (!model) return { providerId: "codex", upstreamModel: null };
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    return { providerId: "codex", upstreamModel: model };
  }
  return { providerId: model.slice(0, separator), upstreamModel: model.slice(separator + 1) };
}

function publicStatusForCode(code: string): number {
  if (["response_not_found", "tool_call_not_found", "unknown_tool_call"].includes(code)) return 404;
  if (["worker_generation_changed", "response_already_waiting"].includes(code)) return 409;
  if (code === "update_in_progress") return 409;
  if (
    [
      "worker_timeout",
      "response_timeout",
      "app_server_request_timeout",
      "provider_timeout",
    ].includes(code)
  ) {
    return 504;
  }
  if (["app_server_not_running", "gateway_not_ready"].includes(code)) return 503;
  if (code === "client_disconnected") return 408;
  if (
    [
      "missing_function_call_output",
      "duplicate_function_call_output",
      "client_tools_disabled",
      "tool_result_too_large",
      "model_provider_not_configured",
      "anthropic_feature_unsupported",
      "invalid_model",
      "external_previous_response_unsupported",
    ].includes(code)
  ) {
    return 400;
  }
  return 502;
}

function publicMessageForCode(code: string): string {
  const messages: Record<string, string> = {
    response_not_found: "Previous response was not found",
    tool_call_not_found: "Tool output does not belong to this response",
    worker_generation_changed: "The Codex worker restarted",
    response_already_waiting: "Another request is already waiting on this response",
    worker_timeout: "The Codex worker timed out",
    response_timeout: "The Codex response timed out",
    client_tools_disabled: "Client function tools are disabled",
    client_disconnected: "The client disconnected",
  };
  return messages[code] ?? "The upstream Codex worker could not complete the request";
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

export function encodeChatCompletionSse(completion: Record<string, unknown>): string {
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(first.message) ? first.message : {};
  const id = typeof completion.id === "string" ? completion.id : "chatcmpl_myt_unknown";
  const model = typeof completion.model === "string" ? completion.model : "unknown";
  const created = typeof completion.created === "number" ? completion.created : 0;
  const base = { id, object: "chat.completion.chunk", created, model };
  const events = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: { content: typeof message.content === "string" ? message.content : "" },
          finish_reason: null,
        },
      ],
    },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
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
