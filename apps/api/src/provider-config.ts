import { readFile } from "node:fs/promises";

import { z } from "zod";

import { MyTokenError } from "@mytoken/shared";

export type ExternalProviderProtocol = "anthropic" | "openai-responses";

export interface ExternalProviderConfig {
  id: string;
  name: string;
  protocol: ExternalProviderProtocol;
  baseUrl: string;
  apiKey: string;
  configuredModels: readonly string[];
}

export interface ProviderConfigurationStatus {
  id: string;
  name: string;
  protocol: ExternalProviderProtocol;
  baseUrl: string;
  enabled: boolean;
  reason: string | null;
}

const providerSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/u),
    name: z.string().min(1).max(64),
    protocol: z.enum(["anthropic", "openai-responses"]),
    baseUrl: z.string().url(),
    apiKeyFile: z.string().min(1).max(4096),
    enabled: z.boolean().optional(),
    models: z.array(z.string().min(1).max(256)).max(256).optional(),
  })
  .strict();

const configSchema = z
  .object({
    providers: z.array(providerSchema).max(32),
  })
  .strict();

export async function loadExternalProviderConfiguration(
  configPath: string | undefined,
  options: { allowInsecureHttp?: boolean } = {},
): Promise<{
  active: ExternalProviderConfig[];
  statuses: ProviderConfigurationStatus[];
}> {
  if (!configPath) return { active: [], statuses: [] };
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isEnoent(error)) return { active: [], statuses: [] };
    throw new MyTokenError(
      "provider_config_unreadable",
      "Provider config could not be read",
      error,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new MyTokenError("provider_config_invalid", "Provider config is not valid JSON", error);
  }
  const parsed = configSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new MyTokenError("provider_config_invalid", "Provider config does not match its schema");
  }
  const seen = new Set<string>();
  const active: ExternalProviderConfig[] = [];
  const statuses: ProviderConfigurationStatus[] = [];
  for (const provider of parsed.data.providers) {
    if (provider.id === "codex" || seen.has(provider.id)) {
      throw new MyTokenError(
        "provider_config_invalid",
        `Duplicate or reserved provider id: ${provider.id}`,
      );
    }
    seen.add(provider.id);
    const baseUrl = new URL(provider.baseUrl);
    if (baseUrl.protocol !== "https:" && !options.allowInsecureHttp) {
      throw new MyTokenError(
        "provider_config_insecure_url",
        `Provider ${provider.id} must use HTTPS`,
      );
    }
    if (provider.enabled === false) {
      statuses.push(status(provider, false, "disabled_by_configuration"));
      continue;
    }
    let apiKey: string;
    try {
      apiKey = (await readFile(provider.apiKeyFile, "utf8")).trim();
    } catch (error) {
      if (isEnoent(error)) {
        statuses.push(status(provider, false, "api_key_file_missing"));
        continue;
      }
      throw new MyTokenError(
        "provider_secret_unreadable",
        `Provider secret could not be read: ${provider.id}`,
        error,
      );
    }
    if (apiKey.length < 8) {
      statuses.push(status(provider, false, "api_key_missing"));
      continue;
    }
    active.push({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: baseUrl.toString().replace(/\/$/u, ""),
      apiKey,
      configuredModels: provider.models ?? [],
    });
    statuses.push(status(provider, true, null));
  }
  return { active, statuses };
}

function status(
  provider: z.infer<typeof providerSchema>,
  enabled: boolean,
  reason: string | null,
): ProviderConfigurationStatus {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    enabled,
    reason,
  };
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
