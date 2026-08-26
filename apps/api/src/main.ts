import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AdminAuthService, bootstrapTokenFromPlaintext } from "@mytoken/admin-auth";
import {
  AdminAuthRepository,
  ApiKeyRepository,
  MyTokenDatabase,
  RequestLogRepository,
} from "@mytoken/database";

import { createApiApp } from "./app.js";
import {
  AnthropicMessagesProviderBackend,
  OpenAIResponsesProviderBackend,
} from "./external-provider-backends.js";
import { MultiProviderGatewayBackend } from "./multi-provider-backend.js";
import { loadExternalProviderConfiguration } from "./provider-config.js";
import { WorkerSocketBackend } from "./worker-socket-backend.js";
import { RequestPolicyManager } from "./request-policy.js";
import { SystemUpdateService } from "./system-update-service.js";

const database = new MyTokenDatabase(requiredEnv("MYTOKEN_DB_PATH"));
database.migrate();
const adminRepository = new AdminAuthRepository(database);
const keyRepository = new ApiKeyRepository(database);
const requestLogRepository = new RequestLogRepository(database);
requestLogRepository.recoverInterrupted();
const policyManager = new RequestPolicyManager(requestLogRepository, {
  globalConcurrency: numberEnv("MYTOKEN_MAX_GLOBAL_CONCURRENCY", 1),
});
const systemUpdate = new SystemUpdateService({
  currentVersion: process.env.MYTOKEN_VERSION ?? "0.1.0-preview.2",
});
const sessionSecret = await readSecret(requiredEnv("MYTOKEN_SESSION_SECRET_FILE"));
const keyPepper = await readSecret(requiredEnv("MYTOKEN_KEY_PEPPER_FILE"));
const adminAuth = new AdminAuthService(adminRepository, sessionSecret);

if (!adminAuth.isInitialized()) {
  const bootstrapPath = requiredEnv("MYTOKEN_BOOTSTRAP_TOKEN_FILE");
  const bootstrapPlaintext = (await readFile(bootstrapPath, "utf8")).trim();
  adminAuth.installBootstrapToken(bootstrapTokenFromPlaintext(bootstrapPlaintext));
}

const codexBackend = new WorkerSocketBackend({
  socketPath: requiredEnv("MYTOKEN_WORKER_SOCKET"),
  requestTimeoutMs: numberEnv("MYTOKEN_REQUEST_TIMEOUT_MS", 120_000),
});
const providerConfiguration = await loadExternalProviderConfiguration(
  process.env.MYTOKEN_PROVIDERS_FILE,
  { allowInsecureHttp: booleanEnv("MYTOKEN_ALLOW_INSECURE_PROVIDERS", false) },
);
const external = providerConfiguration.active.map((provider) => ({
  protocol: provider.protocol,
  backend:
    provider.protocol === "anthropic"
      ? new AnthropicMessagesProviderBackend({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          models: provider.configuredModels,
          timeoutMs: numberEnv("MYTOKEN_PROVIDER_REQUEST_TIMEOUT_MS", 120_000),
        })
      : new OpenAIResponsesProviderBackend({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          models: provider.configuredModels,
          timeoutMs: numberEnv("MYTOKEN_PROVIDER_REQUEST_TIMEOUT_MS", 120_000),
        }),
}));
const backend = new MultiProviderGatewayBackend({
  codex: codexBackend,
  external,
  configurationStatuses: providerConfiguration.statuses,
});
await backend.probe();

const app = await createApiApp({
  backend,
  keyStore: keyRepository,
  keyManagementStore: keyRepository,
  usageStore: requestLogRepository,
  policyManager,
  systemUpdate,
  keyPepper,
  adminAuth,
  codexAdminBackend: backend,
  cookieSecure: process.env.NODE_ENV === "production",
  logger: false,
  trustProxy: trustProxyEnv(),
  staticRoot:
    process.env.MYTOKEN_WEB_ROOT ?? fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
const host = process.env.MYTOKEN_HOST ?? "127.0.0.1";
const port = numberEnv("MYTOKEN_PORT", 8080);
await app.listen({ host, port });
console.log(`MyToken API listening on http://${host}:${String(port)}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  database.close();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

async function readSecret(secretPath: string): Promise<Uint8Array> {
  const value = await readFile(secretPath);
  if (value.byteLength < 32) throw new Error(`Secret file is too short: ${secretPath}`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

function trustProxyEnv(): false | string[] {
  const value = process.env.MYTOKEN_TRUST_PROXY?.trim();
  if (!value) return false;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Environment variable ${name} must be true or false`);
}
