import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { MyTokenError } from "@mytoken/shared";

import {
  loadExternalProviderConfiguration,
  providerConfigSchema,
  type ExternalProviderProtocol,
  type ProviderDefinition,
} from "./provider-config.js";

export interface ManagedProviderView {
  id: string;
  name: string;
  protocol: ExternalProviderProtocol;
  baseUrl: string;
  enabled: boolean;
  models: readonly string[];
  apiKeyConfigured: boolean;
  status: string | null;
}

export interface ManagedProviderInput {
  id: string;
  name: string;
  protocol: ExternalProviderProtocol;
  baseUrl: string;
  enabled: boolean;
  models: readonly string[];
  apiKey?: string;
}

export interface ProviderManagementServiceOptions {
  configPath: string;
  secretDirectory: string;
  allowInsecureHttp?: boolean;
  reload: () => Promise<void>;
}

/** Manages provider declarations without ever returning an upstream API key. */
export class ProviderManagementService {
  readonly #configPath: string;
  readonly #secretDirectory: string;
  readonly #allowInsecureHttp: boolean;
  readonly #reload: () => Promise<void>;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: ProviderManagementServiceOptions) {
    this.#configPath = options.configPath;
    this.#secretDirectory = options.secretDirectory;
    this.#allowInsecureHttp = options.allowInsecureHttp ?? false;
    this.#reload = options.reload;
  }

  async list(): Promise<readonly ManagedProviderView[]> {
    const loaded = await loadExternalProviderConfiguration(this.#configPath, {
      allowInsecureHttp: this.#allowInsecureHttp,
    });
    const statuses = new Map(loaded.statuses.map((status) => [status.id, status]));
    return Promise.all(
      loaded.definitions.map(async (provider) => {
        const status = statuses.get(provider.id);
        const apiKey = await optionalRead(provider.apiKeyFile);
        return {
          id: provider.id,
          name: provider.name,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled !== false,
          models: provider.models ?? [],
          apiKeyConfigured: (apiKey?.trim().length ?? 0) >= 8,
          status: status?.reason ?? null,
        };
      }),
    );
  }

  async upsert(input: ManagedProviderInput): Promise<ManagedProviderView> {
    const operation = this.#mutationQueue.then(async () => this.#upsert(input));
    this.#mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #upsert(input: ManagedProviderInput): Promise<ManagedProviderView> {
    if (input.id === "codex") {
      throw new MyTokenError("provider_id_reserved", "The codex provider is managed separately");
    }
    const current = await this.#readConfiguration();
    const apiKeyFile = join(this.#secretDirectory, input.id);
    const replacement: ProviderDefinition = {
      id: input.id,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      apiKeyFile,
      enabled: input.enabled,
      models: [...input.models],
    };
    const next = {
      providers: [...current.providers.filter((provider) => provider.id !== input.id), replacement],
    };
    const parsed = providerConfigSchema.safeParse(next);
    if (!parsed.success) {
      throw new MyTokenError("provider_config_invalid", "Provider configuration is invalid");
    }
    validateProviderUrl(input.baseUrl, this.#allowInsecureHttp);

    const previousConfig = await optionalRead(this.#configPath);
    const previousSecret = await optionalRead(apiKeyFile);
    try {
      if (input.apiKey !== undefined) {
        await atomicWrite(apiKeyFile, input.apiKey.trim(), 0o600);
      }
      await atomicWrite(
        this.#configPath,
        `${JSON.stringify({ providers: parsed.data.providers }, null, 2)}\n`,
        0o600,
      );
      await this.#reload();
    } catch (error) {
      await restoreFile(this.#configPath, previousConfig, 0o600);
      if (input.apiKey !== undefined) await restoreFile(apiKeyFile, previousSecret, 0o600);
      await this.#reload().catch(() => undefined);
      throw error;
    }
    const configured = (await this.list()).find((provider) => provider.id === input.id);
    if (!configured) throw new Error("Provider disappeared after configuration reload");
    return configured;
  }

  async #readConfiguration(): Promise<{ providers: ProviderDefinition[] }> {
    const text = await optionalRead(this.#configPath);
    if (text === null) return { providers: [] };
    let decoded: unknown;
    try {
      decoded = JSON.parse(text) as unknown;
    } catch (error) {
      throw new MyTokenError("provider_config_invalid", "Provider config is not valid JSON", error);
    }
    const parsed = providerConfigSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new MyTokenError(
        "provider_config_invalid",
        "Provider config does not match its schema",
      );
    }
    return { providers: parsed.data.providers };
  }
}

function validateProviderUrl(value: string, allowInsecureHttp: boolean): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && !allowInsecureHttp) {
    throw new MyTokenError("provider_config_insecure_url", "Provider base URL must use HTTPS");
  }
}

async function optionalRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function atomicWrite(path: string, value: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomBytes(12).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, value, { encoding: "utf8", flag: "wx", mode });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function restoreFile(path: string, value: string | null, mode: number): Promise<void> {
  if (value === null) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(path, value, mode);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
