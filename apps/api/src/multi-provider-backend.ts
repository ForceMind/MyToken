import type { CreateResponseRequest, GatewayResponse } from "@mytoken/openai-compat";
import { MyTokenError } from "@mytoken/shared";

import type { CodexAdminBackend } from "./admin-routes.js";
import type {
  GatewayBackend,
  GatewayModel,
  GatewayProviderStatus,
  GatewayStreamEvent,
} from "./app.js";
import type { ExternalProviderBackend } from "./external-provider-backends.js";
import type { ProviderConfigurationStatus } from "./provider-config.js";

export interface RoutedExternalProvider {
  backend: ExternalProviderBackend;
  protocol: string;
}

export class MultiProviderGatewayBackend implements GatewayBackend, CodexAdminBackend {
  readonly #codex: GatewayBackend & CodexAdminBackend;
  #external = new Map<string, RoutedExternalProvider>();
  #configurationStatuses: readonly ProviderConfigurationStatus[];
  #lastProbeAt = 0;
  #lastProbeReady = false;

  constructor(options: {
    codex: GatewayBackend & CodexAdminBackend;
    external?: readonly RoutedExternalProvider[];
    configurationStatuses?: readonly ProviderConfigurationStatus[];
  }) {
    this.#codex = options.codex;
    this.#configurationStatuses = options.configurationStatuses ?? [];
    this.#replaceExternal(options.external ?? []);
  }

  replaceExternal(options: {
    external: readonly RoutedExternalProvider[];
    configurationStatuses: readonly ProviderConfigurationStatus[];
  }): void {
    this.#replaceExternal(options.external);
    this.#configurationStatuses = options.configurationStatuses;
    this.#lastProbeAt = 0;
    this.#lastProbeReady = false;
  }

  #replaceExternal(providers: readonly RoutedExternalProvider[]): void {
    const replacement = new Map<string, RoutedExternalProvider>();
    for (const provider of providers) {
      if (provider.backend.providerId === "codex" || replacement.has(provider.backend.providerId)) {
        throw new MyTokenError(
          "duplicate_provider",
          `Duplicate or reserved provider id: ${provider.backend.providerId}`,
        );
      }
      replacement.set(provider.backend.providerId, provider);
    }
    this.#external = replacement;
  }

  isReady(): boolean {
    return this.#lastProbeReady;
  }

  async probe(): Promise<boolean> {
    if (Date.now() - this.#lastProbeAt < 10_000) return this.#lastProbeReady;
    const results = await Promise.allSettled([
      boundedProbe(this.#probeCodex()),
      ...[...this.#external.values()].map(({ backend }) =>
        boundedProbe(Promise.resolve(backend.probe?.() ?? backend.isReady())),
      ),
    ]);
    this.#lastProbeAt = Date.now();
    this.#lastProbeReady = results.some(
      (result) => result.status === "fulfilled" && result.value === true,
    );
    return this.#lastProbeReady;
  }

  async #probeCodex(): Promise<boolean> {
    const workerReady = this.#codex.probe ? await this.#codex.probe() : this.#codex.isReady();
    if (!workerReady) return false;
    return (await safeAccount(this.#codex)).connected;
  }

  async listModels(): Promise<readonly GatewayModel[]> {
    const entries: Array<Promise<readonly GatewayModel[]>> = [
      this.#codex.listModels().then((models) =>
        models.map((model) => ({
          ...model,
          providerId: "codex",
          providerName: "Codex",
          upstreamModel: model.id,
          supportsTools: true,
          supportsStreaming: true,
        })),
      ),
      ...[...this.#external.values()].map(({ backend }) => backend.listModels()),
    ];
    const results = await Promise.allSettled(entries);
    const models = results.flatMap((result) =>
      result.status === "fulfilled" ? [...result.value] : [],
    );
    if (models.length === 0) {
      throw new MyTokenError("no_provider_models", "No configured provider returned models");
    }
    return models;
  }

  createResponse(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
  ): Promise<GatewayResponse> {
    const resolved = resolveProviderModel(request.model);
    if (resolved.providerId === "codex") {
      return this.#codex.createResponse({ ...request, model: resolved.upstreamModel }, context);
    }
    const provider = this.#external.get(resolved.providerId);
    if (!provider) {
      return Promise.reject(
        new MyTokenError(
          "model_provider_not_configured",
          `Model provider is not configured: ${resolved.providerId}`,
        ),
      );
    }
    return provider.backend.createResponse(request, context);
  }

  async createResponseStream(
    request: CreateResponseRequest,
    context: { apiKeyId: string; signal?: AbortSignal },
    emit: (event: GatewayStreamEvent) => Promise<void> | void,
  ): Promise<void> {
    const resolved = resolveProviderModel(request.model);
    if (resolved.providerId === "codex" && this.#codex.createResponseStream) {
      return this.#codex.createResponseStream(
        { ...request, model: resolved.upstreamModel },
        context,
        emit,
      );
    }
    const response = await this.createResponse({ ...request, stream: false }, context);
    await emit({
      type: "response.created",
      response: {
        id: response.id,
        object: response.object,
        created_at: response.created_at,
        model: response.model,
      },
    });
    if (response.output_text) await emit({ type: "text.delta", delta: response.output_text });
    if (response.status !== "completed") {
      await emit({ type: "response.failed", response });
    } else if (response.output.some((item) => item.type === "function_call")) {
      await emit({ type: "response.tool_call", response });
    } else {
      await emit({ type: "response.completed", response });
    }
  }

  async providerStatuses(): Promise<readonly GatewayProviderStatus[]> {
    const statuses: GatewayProviderStatus[] = [];
    const [codexModels, codexAccount] = await Promise.all([
      safeModels(this.#codex),
      safeAccount(this.#codex),
    ]);
    const codexReady = codexModels.ok && codexAccount.ok && codexAccount.connected;
    statuses.push({
      id: "codex",
      name: "Codex",
      protocol: "codex-app-server",
      enabled: true,
      ready: codexReady,
      modelsCount: codexModels.models.length,
      error: !codexAccount.ok
        ? "codex_unavailable"
        : !codexAccount.connected
          ? "codex_not_authenticated"
          : codexModels.ok
            ? null
            : "codex_models_unavailable",
    });
    for (const { backend, protocol } of this.#external.values()) {
      const models = await safeModels(backend);
      statuses.push({
        id: backend.providerId,
        name: backend.providerName,
        protocol,
        enabled: true,
        ready: models.ok,
        modelsCount: models.models.length,
        error: models.ok ? null : "provider_unavailable",
      });
    }
    for (const configured of this.#configurationStatuses) {
      if (statuses.some((status) => status.id === configured.id)) continue;
      statuses.push({
        id: configured.id,
        name: configured.name,
        protocol: configured.protocol,
        enabled: configured.enabled,
        ready: false,
        modelsCount: 0,
        error: configured.reason,
      });
    }
    return statuses;
  }

  account(): Promise<unknown> {
    return this.#codex.account();
  }
  rateLimits(): Promise<unknown> {
    return this.#codex.rateLimits();
  }
  usage(): Promise<unknown> {
    return this.#codex.usage();
  }
  startDeviceLogin(): Promise<unknown> {
    return this.#codex.startDeviceLogin();
  }
  cancelDeviceLogin(loginId: string): Promise<unknown> {
    return this.#codex.cancelDeviceLogin(loginId);
  }
  logoutAccount(): Promise<unknown> {
    return this.#codex.logoutAccount();
  }
}

async function safeAccount(backend: CodexAdminBackend): Promise<{
  ok: boolean;
  connected: boolean;
}> {
  try {
    const value = await backend.account();
    return { ok: true, connected: isRecord(value) && isRecord(value.account) };
  } catch {
    return { ok: false, connected: false };
  }
}

export function resolveProviderModel(model: string): {
  providerId: string;
  upstreamModel: string;
} {
  const separator = model.indexOf("/");
  if (separator < 0) return { providerId: "codex", upstreamModel: model };
  if (separator === 0 || separator === model.length - 1) {
    throw new MyTokenError("invalid_model", "Model id must be provider/model");
  }
  return { providerId: model.slice(0, separator), upstreamModel: model.slice(separator + 1) };
}

async function safeModels(backend: GatewayBackend): Promise<{
  ok: boolean;
  models: readonly GatewayModel[];
}> {
  try {
    const models = await boundedModels(backend.listModels());
    return models ? { ok: true, models } : { ok: false, models: [] };
  } catch {
    return { ok: false, models: [] };
  }
}

async function boundedModels(
  models: Promise<readonly GatewayModel[]>,
  timeoutMs = 5_000,
): Promise<readonly GatewayModel[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      models,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedProbe(probe: Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
