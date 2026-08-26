import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AdminAuthService } from "../packages/admin-auth/src/index.js";
import {
  AdminAuthRepository,
  ApiKeyRepository,
  MyTokenDatabase,
  RequestLogRepository,
} from "../packages/database/src/index.js";
import { createGatewayResponse } from "../packages/openai-compat/src/index.js";
import { createApiApp, type GatewayBackend } from "../apps/api/src/app.js";
import type { CodexAdminBackend } from "../apps/api/src/admin-routes.js";
import { RequestPolicyManager } from "../apps/api/src/request-policy.js";
import type {
  ManagedProviderInput,
  ManagedProviderView,
} from "../apps/api/src/provider-management-service.js";

const database = new MyTokenDatabase(":memory:");
const release = JSON.parse(
  readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8"),
) as { version: string };
database.migrate();
const adminAuth = new AdminAuthService(new AdminAuthRepository(database), randomBytes(32));
const bootstrap = adminAuth.createBootstrapToken();
adminAuth.installBootstrapToken(bootstrap);
const keyStore = new ApiKeyRepository(database);
const usageStore = new RequestLogRepository(database);
const policyManager = new RequestPolicyManager(usageStore, { globalConcurrency: 2 });
let managedProviders: ManagedProviderView[] = [
  {
    id: "anthropic",
    name: "Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    enabled: true,
    models: [],
    apiKeyConfigured: false,
    status: "api_key_file_missing",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-chat",
    baseUrl: "https://api.deepseek.com",
    enabled: true,
    models: [],
    apiKeyConfigured: false,
    status: "api_key_file_missing",
  },
];

const backend: GatewayBackend & CodexAdminBackend = {
  isReady: () => true,
  listModels: () => Promise.resolve([{ id: "gpt-preview", displayName: "GPT Preview" }]),
  createResponse: (request) =>
    Promise.resolve(
      createGatewayResponse({
        id: "resp_myt_preview",
        model: request.model,
        output: [
          {
            type: "message",
            id: "msg_myt_preview",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Preview response", annotations: [] }],
          },
        ],
      }),
    ),
  account: () =>
    Promise.resolve({
      account: { type: "chatgpt", email: "preview@example.com", planType: "plus" },
      requiresOpenaiAuth: true,
    }),
  rateLimits: () =>
    Promise.resolve({
      rateLimits: {
        primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: null,
      },
    }),
  usage: () =>
    Promise.resolve({
      summary: { lifetimeTokens: 12_345, peakDailyTokens: 1_234, currentStreakDays: 3 },
      dailyUsageBuckets: [{ startDate: "2026-08-25", tokens: 1_234 }],
    }),
  startDeviceLogin: () =>
    Promise.resolve({
      type: "chatgptDeviceCode",
      loginId: "preview-login",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "DEMO-CODE",
    }),
  cancelDeviceLogin: () => Promise.resolve({}),
  logoutAccount: () => Promise.resolve({}),
  providerStatuses: () =>
    Promise.resolve([
      {
        id: "codex",
        name: "Codex",
        protocol: "codex-app-server",
        enabled: true,
        ready: true,
        modelsCount: 1,
        error: null,
      },
      ...managedProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        enabled: provider.enabled && provider.apiKeyConfigured,
        ready: provider.enabled && provider.apiKeyConfigured,
        modelsCount: provider.models.length,
        error: provider.apiKeyConfigured ? null : "api_key_file_missing",
      })),
    ]),
};

const app = await createApiApp({
  backend,
  keyStore,
  keyManagementStore: keyStore,
  keyPepper: randomBytes(32),
  adminAuth,
  codexAdminBackend: backend,
  usageStore,
  policyManager,
  providerManagement: {
    list: () => Promise.resolve(managedProviders),
    upsert: (input: ManagedProviderInput) => {
      const configured: ManagedProviderView = {
        id: input.id,
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        enabled: input.enabled,
        models: input.models,
        apiKeyConfigured: Boolean(input.apiKey),
        status: null,
      };
      managedProviders = [
        ...managedProviders.filter((provider) => provider.id !== input.id),
        configured,
      ];
      return Promise.resolve(configured);
    },
  },
  version: release.version,
  cookieSecure: false,
  staticRoot: fileURLToPath(new URL("../apps/web/dist", import.meta.url)),
  logger: false,
});
await app.listen({ host: "127.0.0.1", port: 4173 });
console.log(`Preview URL: http://127.0.0.1:4173`);
console.log(`Preview Bootstrap Token: ${bootstrap.plaintext}`);

async function shutdown(): Promise<void> {
  await app.close();
  database.close();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
