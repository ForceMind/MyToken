import type { CreateResponseRequest, GatewayResponse } from "@mytoken/openai-compat";
import { createGatewayResponse, type ResponseOutputItem } from "@mytoken/openai-compat";
import { MyTokenError, redactText } from "@mytoken/shared";

import type { GatewayBackend, GatewayModel } from "./app.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const ANTHROPIC_VERSION = "2023-06-01";

export interface ExternalProviderBackendOptions {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
  models?: readonly string[];
}

export interface ExternalProviderBackend extends GatewayBackend {
  readonly providerId: string;
  readonly providerName: string;
}

/** A provider using the OpenAI Responses wire format (including DeepSeek). */
export class OpenAIResponsesProviderBackend implements ExternalProviderBackend {
  readonly providerId: string;
  readonly providerName: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #configuredModels: readonly string[];

  constructor(options: ExternalProviderBackendOptions) {
    validateOptions(options);
    this.providerId = options.id;
    this.providerName = options.name;
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#configuredModels = options.models ?? [];
  }

  isReady(): boolean {
    return Boolean(this.#apiKey);
  }

  async probe(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly GatewayModel[]> {
    if (this.#configuredModels.length > 0) {
      return this.#configuredModels.map((id) => this.model(id, id));
    }
    const body = await this.#request("/models", { method: "GET" });
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new MyTokenError(
        "invalid_provider_response",
        "Provider returned an invalid model list",
      );
    }
    return body.data.map((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
        throw new MyTokenError("invalid_provider_response", "Provider returned a malformed model");
      }
      return this.model(value.id, modelName(value));
    });
  }

  async createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
  ): Promise<GatewayResponse> {
    if (request.previous_response_id) {
      throw new MyTokenError(
        "external_previous_response_unsupported",
        "External provider is stateless; send the complete input history",
      );
    }
    const body = await this.#request("/responses", {
      method: "POST",
      body: JSON.stringify(toOpenAIRequest(request, this.providerId)),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    return parseOpenAIResponse(body, request.model);
  }

  protected publicModelId(upstreamId: string): string {
    return `${this.providerId}/${upstreamId}`;
  }

  private model(upstreamId: string, displayName: string): GatewayModel {
    return {
      id: this.publicModelId(upstreamId),
      displayName,
      providerId: this.providerId,
      providerName: this.providerName,
      upstreamModel: upstreamId,
      supportsTools: true,
      supportsStreaming: false,
    };
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    return requestJson(
      this.#fetch,
      `${this.#baseUrl}${path}`,
      this.#apiKey,
      init,
      this.#timeoutMs,
      this.#maxResponseBytes,
    );
  }
}

export function createDeepSeekBackend(
  apiKey: string,
  options: Partial<Omit<ExternalProviderBackendOptions, "id" | "name" | "baseUrl" | "apiKey">> = {},
): OpenAIResponsesProviderBackend {
  return new OpenAIResponsesProviderBackend({
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKey,
    ...options,
  });
}

export interface AnthropicProviderBackendOptions extends Omit<
  ExternalProviderBackendOptions,
  "baseUrl"
> {
  baseUrl?: string;
}

export class AnthropicMessagesProviderBackend implements ExternalProviderBackend {
  readonly providerId: string;
  readonly providerName: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #configuredModels: readonly string[];

  constructor(options: AnthropicProviderBackendOptions) {
    validateOptions({ ...options, baseUrl: options.baseUrl ?? "https://api.anthropic.com" });
    this.providerId = options.id;
    this.providerName = options.name;
    this.#baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/u, "");
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#configuredModels = options.models ?? [];
  }

  isReady(): boolean {
    return Boolean(this.#apiKey);
  }

  async probe(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly GatewayModel[]> {
    if (this.#configuredModels.length > 0) {
      return this.#configuredModels.map((id) => this.model(id, id));
    }
    const body = await requestJson(
      this.#fetch,
      `${this.#baseUrl}/v1/models`,
      this.#apiKey,
      {
        method: "GET",
        headers: { "anthropic-version": ANTHROPIC_VERSION },
      },
      this.#timeoutMs,
      this.#maxResponseBytes,
      "anthropic",
    );
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new MyTokenError(
        "invalid_provider_response",
        "Provider returned an invalid model list",
      );
    }
    return body.data.map((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
        throw new MyTokenError("invalid_provider_response", "Provider returned a malformed model");
      }
      return this.model(value.id, modelName(value));
    });
  }

  async createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
  ): Promise<GatewayResponse> {
    if (request.tools?.length || request.previous_response_id) {
      throw new MyTokenError(
        "anthropic_feature_unsupported",
        "Anthropic backend does not support tools or previous_response_id",
      );
    }
    const converted = toAnthropicRequest(request, this.providerId);
    const body = await requestJson(
      this.#fetch,
      `${this.#baseUrl}/v1/messages`,
      this.#apiKey,
      {
        method: "POST",
        headers: { "anthropic-version": ANTHROPIC_VERSION },
        body: JSON.stringify(converted),
        ...(context.signal ? { signal: context.signal } : {}),
      },
      this.#timeoutMs,
      this.#maxResponseBytes,
      "anthropic",
    );
    return parseAnthropicResponse(body, request.model);
  }

  private model(upstreamId: string, displayName: string): GatewayModel {
    return {
      id: `${this.providerId}/${upstreamId}`,
      displayName,
      providerId: this.providerId,
      providerName: this.providerName,
      upstreamModel: upstreamId,
      supportsTools: false,
      supportsStreaming: false,
    };
  }
}

export function createAnthropicBackend(
  apiKey: string,
  options: Partial<Omit<AnthropicProviderBackendOptions, "apiKey">> = {},
): AnthropicMessagesProviderBackend {
  return new AnthropicMessagesProviderBackend({
    id: "anthropic",
    name: "Anthropic",
    apiKey,
    ...options,
  });
}

function validateOptions(options: ExternalProviderBackendOptions): void {
  if (!options.id || !/^[a-z0-9_-]+$/u.test(options.id))
    throw new MyTokenError("invalid_provider_config", "Provider id is invalid");
  if (!options.name || !options.baseUrl || !options.apiKey)
    throw new MyTokenError(
      "invalid_provider_config",
      "Provider name, base URL and API key are required",
    );
  try {
    new URL(options.baseUrl);
  } catch (error) {
    throw new MyTokenError("invalid_provider_config", "Provider base URL is invalid", error);
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 600_000)
  )
    throw new MyTokenError("invalid_provider_config", "Provider timeout is out of range");
  if (
    options.maxResponseBytes !== undefined &&
    (!Number.isInteger(options.maxResponseBytes) ||
      options.maxResponseBytes < 1024 ||
      options.maxResponseBytes > 64 * 1024 * 1024)
  )
    throw new MyTokenError("invalid_provider_config", "Provider response limit is out of range");
}

function toOpenAIRequest(
  request: CreateResponseRequest,
  providerId: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...request,
    model: stripModelPrefix(request.model, providerId),
    stream: false,
  };
  delete body.store;
  return body;
}

function toAnthropicRequest(
  request: CreateResponseRequest,
  providerId: string,
): Record<string, unknown> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const system: string[] = request.instructions ? [request.instructions] : [];
  const add = (role: string, content: unknown) => {
    if (role === "system" || role === "developer") {
      system.push(typeof content === "string" ? content : textFromContent(content));
      return;
    }
    if (role !== "user" && role !== "assistant") {
      throw new MyTokenError("anthropic_feature_unsupported", "Unsupported Anthropic message role");
    }
    messages.push({
      role,
      content: typeof content === "string" ? content : textFromContent(content),
    });
  };
  if (typeof request.input === "string") add("user", request.input);
  else
    for (const item of request.input) {
      if (item.type !== "message")
        throw new MyTokenError(
          "anthropic_feature_unsupported",
          "Anthropic backend only supports message input",
        );
      add(item.role, item.content);
    }
  const body: Record<string, unknown> = {
    model: stripModelPrefix(request.model, providerId),
    max_tokens: request.max_output_tokens ?? 4096,
    messages,
  };
  if (system.length > 0) body.system = system.join("\n\n");
  return body;
}

function textFromContent(value: unknown): string {
  if (!Array.isArray(value))
    throw new MyTokenError("invalid_provider_request", "Message content is invalid");
  return value
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function parseOpenAIResponse(value: unknown, requestedModel: string): GatewayResponse {
  if (!isRecord(value))
    throw new MyTokenError("invalid_provider_response", "Provider response is invalid");
  const output = parseOutput(value.output);
  const usage = parseUsage(value.usage);
  return createGatewayResponse({
    id: `resp_myt_${crypto.randomUUID()}`,
    model: requestedModel,
    output,
    usage,
  });
}

function parseAnthropicResponse(value: unknown, requestedModel: string): GatewayResponse {
  if (!isRecord(value) || !Array.isArray(value.content))
    throw new MyTokenError("invalid_provider_response", "Anthropic response is invalid");
  const text = value.content
    .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("");
  const output: ResponseOutputItem[] = [
    {
      type: "message",
      id: `msg_myt_${crypto.randomUUID()}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  ];
  const usageValue = isRecord(value.usage)
    ? {
        input_tokens: value.usage.input_tokens,
        output_tokens: value.usage.output_tokens,
        total_tokens:
          (Number(value.usage.input_tokens) || 0) + (Number(value.usage.output_tokens) || 0),
      }
    : undefined;
  return createGatewayResponse({
    id: `resp_myt_${crypto.randomUUID()}`,
    model: requestedModel,
    output,
    usage: parseUsage(usageValue),
  });
}

function parseOutput(value: unknown): ResponseOutputItem[] {
  if (!Array.isArray(value))
    throw new MyTokenError("invalid_provider_response", "Provider response output is invalid");
  return value.flatMap((item): ResponseOutputItem[] => {
    if (!isRecord(item) || typeof item.type !== "string") {
      throw new MyTokenError(
        "invalid_provider_response",
        "Provider returned a malformed output item",
      );
    }
    if (item.type === "reasoning") return [];
    if (item.type === "message") {
      const content = Array.isArray(item.content)
        ? item.content.flatMap((part) =>
            isRecord(part) && part.type === "output_text" && typeof part.text === "string"
              ? [{ type: "output_text" as const, text: part.text, annotations: [] as [] }]
              : [],
          )
        : [];
      return [
        {
          type: "message" as const,
          id: stringOr(item.id, `msg_${crypto.randomUUID()}`),
          role: "assistant" as const,
          status: "completed" as const,
          content,
        },
      ];
    }
    if (
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string"
    )
      return [
        {
          type: "function_call" as const,
          id: stringOr(item.id, `fc_${crypto.randomUUID()}`),
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
          status: "completed" as const,
        },
      ];
    throw new MyTokenError(
      "invalid_provider_response",
      "Provider returned an unsupported output item",
    );
  });
}

function parseUsage(value: unknown): GatewayResponse["usage"] {
  if (!isRecord(value)) return null;
  const input = Number(value.input_tokens);
  const output = Number(value.output_tokens);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0)
    return null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number.isSafeInteger(Number(value.total_tokens))
      ? Number(value.total_tokens)
      : input + output,
  };
}

async function requestJson(
  fetcher: typeof globalThis.fetch,
  url: string,
  apiKey: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number,
  authMode: "bearer" | "anthropic" = "bearer",
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const headers = new Headers(init.headers);
    if (authMode === "anthropic") headers.set("x-api-key", apiKey);
    else headers.set("authorization", `Bearer ${apiKey}`);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetcher(url, { ...init, headers, signal: controller.signal });
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes)
      throw new MyTokenError("provider_response_too_large", "Provider response exceeded limit");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new MyTokenError("provider_response_too_large", "Provider response exceeded limit");
    if (!response.ok)
      throw new MyTokenError(
        "provider_request_failed",
        `External provider request failed (${response.status})`,
        redactText(text.slice(0, 256)),
      );
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new MyTokenError(
        "invalid_provider_json",
        "External provider returned invalid JSON",
        error,
      );
    }
  } catch (error) {
    if (error instanceof MyTokenError) throw error;
    if (init.signal?.aborted) throw new MyTokenError("client_disconnected", "Client disconnected");
    if (controller.signal.aborted)
      throw new MyTokenError("provider_timeout", "External provider request timed out");
    throw new MyTokenError("provider_unavailable", "External provider is unavailable", error);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

function stripModelPrefix(model: string, providerId: string): string {
  return model.startsWith(`${providerId}/`) ? model.slice(providerId.length + 1) : model;
}
function modelName(value: Record<string, unknown>): string {
  return typeof value.display_name === "string"
    ? value.display_name
    : typeof value.name === "string"
      ? value.name
      : String(value.id);
}
function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
