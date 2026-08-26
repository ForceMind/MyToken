import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AdminAuthService, type AuthenticatedAdminSession } from "@mytoken/admin-auth";
import {
  createMyTokenKey,
  type MyTokenKeyRecord,
  type CreateMyTokenKeyOptions,
  type UpdateMyTokenKeyPolicy,
} from "@mytoken/key-auth";
import { openAiError } from "@mytoken/openai-compat";

import type { ApiKeyStore } from "./app.js";
import type { ManagedProviderInput, ManagedProviderView } from "./provider-management-service.js";
import { validateIpAllowlist } from "./request-policy.js";
import type { RequestPolicyManager } from "./request-policy.js";
import type { GatewayUsageStore } from "./usage-store.js";
import type { SystemUpdateService } from "./system-update-service.js";

export interface ApiKeyManagementStore extends ApiKeyStore {
  create(record: MyTokenKeyRecord): void;
  revoke(keyId: string, now?: number): boolean;
  list(): Promise<readonly MyTokenKeyRecord[]>;
  touchLastUsed(keyId: string, now?: number): void;
  updatePolicy(keyId: string, patch: UpdateMyTokenKeyPolicy): Promise<boolean>;
}

export interface CodexAdminBackend {
  account(): Promise<unknown>;
  rateLimits(): Promise<unknown>;
  usage(): Promise<unknown>;
  listModels(): Promise<readonly { id: string; displayName: string }[]>;
  providerStatuses?(): Promise<
    readonly {
      id: string;
      name: string;
      protocol: string;
      enabled: boolean;
      ready: boolean;
      modelsCount: number;
      error: string | null;
    }[]
  >;
  startDeviceLogin(): Promise<unknown>;
  cancelDeviceLogin(loginId: string): Promise<unknown>;
  logoutAccount(): Promise<unknown>;
}

export interface RegisterAdminRoutesOptions {
  adminAuth: AdminAuthService;
  keyStore: ApiKeyManagementStore;
  keyPepper: Uint8Array;
  cookieSecure: boolean;
  codexBackend?: CodexAdminBackend;
  usageStore?: GatewayUsageStore;
  policyManager?: RequestPolicyManager;
  systemUpdate?: SystemUpdateService;
  providerManagement?: {
    list(): Promise<readonly ManagedProviderView[]>;
    upsert(input: ManagedProviderInput): Promise<ManagedProviderView>;
  };
}

const setupSchema = z
  .object({
    bootstrapToken: z.string().min(1).max(256),
    username: z.string().min(3).max(64),
    password: z.string().min(12).max(1024),
  })
  .strict();

const loginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();

const createKeySchema = z
  .object({
    mode: z.enum(["live", "test"]),
    name: z.string().min(1).max(128),
    expiresAt: z.number().int().positive().nullable().optional(),
    allowedModels: z.array(z.string().min(1).max(256)).max(128).optional(),
    allowClientTools: z.boolean().optional(),
    rpmLimit: z.number().int().min(1).max(10_000).optional(),
    dailyRequestLimit: z.number().int().min(1).max(1_000_000).optional(),
    maxConcurrency: z.number().int().min(1).max(32).optional(),
    ipAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(),
    requestBudget: z.number().int().min(1).max(100_000_000).nullable().optional(),
    tokenBudget: z.number().int().min(1).max(1_000_000_000_000).nullable().optional(),
  })
  .strict();

const updateKeySchema = createKeySchema
  .omit({ mode: true, name: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);

const providerInputSchema = z
  .object({
    name: z.string().min(1).max(64),
    protocol: z.enum(["anthropic", "openai-responses", "openai-chat"]),
    baseUrl: z.string().url().max(2048),
    enabled: z.boolean(),
    models: z.array(z.string().min(1).max(256)).max(256),
    apiKey: z.string().min(8).max(8192).optional(),
  })
  .strict();

export function registerAdminRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions,
): void {
  const cookieName = options.cookieSecure ? "__Host-mytoken_session" : "mytoken_session";

  app.get("/api/admin/setup/status", (_request, reply) => {
    noStore(reply);
    return { initialized: options.adminAuth.isInitialized() };
  });

  app.post(
    "/api/admin/setup",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      noStore(reply);
      const parsed = setupSchema.safeParse(request.body);
      if (!parsed.success) return adminError(reply, 400, "Invalid setup request", "invalid_setup");
      if (options.adminAuth.isInitialized()) {
        return adminError(
          reply,
          409,
          "Administrator is already initialized",
          "already_initialized",
        );
      }
      try {
        const user = await options.adminAuth.bootstrap(parsed.data);
        return reply.code(201).send({ user });
      } catch {
        return adminError(reply, 401, "Bootstrap token is invalid", "invalid_bootstrap");
      }
    },
  );

  app.post(
    "/api/admin/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      noStore(reply);
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return adminError(reply, 401, "Invalid username or password", "invalid_credentials");
      }
      try {
        const login = await options.adminAuth.login({
          ...parsed.data,
          userAgentHash: fingerprint(request.headers["user-agent"]),
          ipFingerprint: fingerprint(request.ip),
        });
        reply.setCookie(cookieName, login.sessionToken, {
          httpOnly: true,
          secure: options.cookieSecure,
          sameSite: "strict",
          path: "/",
          expires: new Date(login.expiresAt),
        });
        return { user: login.user, csrfToken: login.csrfToken, expiresAt: login.expiresAt };
      } catch {
        return adminError(reply, 401, "Invalid username or password", "invalid_credentials");
      }
    },
  );

  app.get("/api/admin/session", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName);
    if (!session) return;
    return { user: { id: session.user.id, username: session.user.username } };
  });

  app.post("/api/admin/logout", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    options.adminAuth.logout(session.session.id);
    reply.clearCookie(cookieName, { path: "/" });
    return reply.code(204).send();
  });

  app.post("/api/admin/keys", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    const parsed = createKeySchema.safeParse(request.body);
    if (!parsed.success) return adminError(reply, 400, "Invalid key policy", "invalid_key_policy");

    const keyOptions: CreateMyTokenKeyOptions = {
      mode: parsed.data.mode,
      name: parsed.data.name,
      allowedModels: parsed.data.allowedModels ?? [],
      allowClientTools: parsed.data.allowClientTools ?? false,
      ipAllowlist: parsed.data.ipAllowlist ?? [],
      requestBudget: parsed.data.requestBudget ?? null,
      tokenBudget: parsed.data.tokenBudget ?? null,
    };
    try {
      validateIpAllowlist(keyOptions.ipAllowlist ?? []);
    } catch {
      return adminError(reply, 400, "Invalid IP or CIDR allowlist", "invalid_ip_allowlist");
    }
    if ((keyOptions.allowedModels?.length ?? 0) > 0 && options.codexBackend) {
      const available = new Set((await options.codexBackend.listModels()).map((model) => model.id));
      const unknown = keyOptions.allowedModels?.find((model) => !available.has(model));
      if (unknown) {
        return adminError(reply, 400, `Unknown or unavailable model: ${unknown}`, "invalid_model");
      }
    }
    if (parsed.data.expiresAt !== undefined) keyOptions.expiresAt = parsed.data.expiresAt;
    if (parsed.data.rpmLimit !== undefined) keyOptions.rpmLimit = parsed.data.rpmLimit;
    if (parsed.data.dailyRequestLimit !== undefined) {
      keyOptions.dailyRequestLimit = parsed.data.dailyRequestLimit;
    }
    if (parsed.data.maxConcurrency !== undefined) {
      keyOptions.maxConcurrency = parsed.data.maxConcurrency;
    }
    const created = createMyTokenKey(options.keyPepper, keyOptions);
    options.keyStore.create(created.record);
    return reply.code(201).send({
      key: created.plaintext,
      id: created.record.id,
      mode: created.record.mode,
      name: created.record.name,
      prefix: created.record.prefix,
      createdAt: created.record.createdAt,
      expiresAt: created.record.expiresAt,
      revokedAt: created.record.revokedAt,
      lastUsedAt: created.record.lastUsedAt,
      allowedModels: created.record.allowedModels,
      allowClientTools: created.record.allowClientTools,
      rpmLimit: created.record.rpmLimit,
      dailyRequestLimit: created.record.dailyRequestLimit,
      maxConcurrency: created.record.maxConcurrency,
      ipAllowlist: created.record.ipAllowlist,
      requestBudget: created.record.requestBudget,
      tokenBudget: created.record.tokenBudget,
      requestBalance: created.record.requestBudget,
      tokenBalance: created.record.tokenBudget,
      activeRequests: 0,
      usage: emptyUsage(),
    });
  });

  app.get("/api/admin/keys", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName);
    if (!session) return;
    const records = await options.keyStore.list();
    return {
      data: records.map((record) => {
        const usage = options.usageStore?.usage(record.id) ?? emptyUsage();
        return {
          id: record.id,
          mode: record.mode,
          name: record.name,
          prefix: record.prefix,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          revokedAt: record.revokedAt,
          lastUsedAt: record.lastUsedAt,
          allowedModels: record.allowedModels,
          allowClientTools: record.allowClientTools,
          rpmLimit: record.rpmLimit,
          dailyRequestLimit: record.dailyRequestLimit,
          maxConcurrency: record.maxConcurrency,
          ipAllowlist: record.ipAllowlist,
          requestBudget: record.requestBudget,
          tokenBudget: record.tokenBudget,
          requestBalance:
            record.requestBudget === null
              ? null
              : Math.max(0, record.requestBudget - usage.billableRequests),
          tokenBalance:
            record.tokenBudget === null
              ? null
              : Math.max(0, record.tokenBudget - usage.totalTokens),
          activeRequests: options.policyManager?.activeForKey(record.id) ?? 0,
          usage,
        };
      }),
    };
  });

  if (options.usageStore) {
    app.get("/api/admin/requests", async (request, reply) => {
      noStore(reply);
      const session = authenticateAdmin(request, reply, options, cookieName);
      if (!session) return;
      const query = request.query as { keyId?: string; limit?: string; offset?: string };
      const limit = boundedInteger(query.limit, 100, 1, 200);
      const offset = boundedInteger(query.offset, 0, 0, 1_000_000);
      return {
        data: options.usageStore?.list({
          ...(query.keyId ? { apiKeyId: query.keyId } : {}),
          limit,
          offset,
        }),
      };
    });
  }

  const systemUpdate = options.systemUpdate;
  if (systemUpdate) {
    app.get("/api/admin/system/update", async (request, reply) => {
      noStore(reply);
      const session = authenticateAdmin(request, reply, options, cookieName);
      if (!session) return;
      const [latest, status] = await Promise.all([
        systemUpdate.getLatestVersion(),
        systemUpdate.readStatus(),
      ]);
      return {
        currentVersion: systemUpdate.currentVersion,
        latest,
        status,
      };
    });
    app.post(
      "/api/admin/system/update",
      { config: { rateLimit: { max: 1, timeWindow: "10 minutes" } } },
      async (request, reply) => {
        noStore(reply);
        const session = authenticateAdmin(request, reply, options, cookieName, true);
        if (!session) return;
        if (!sameOrigin(request)) {
          return adminError(reply, 403, "Update request origin was rejected", "invalid_origin");
        }
        const requested = await systemUpdate.requestUpdate();
        return reply.code(202).send({ requested });
      },
    );
  }

  const providerManagement = options.providerManagement;
  if (providerManagement) {
    app.get("/api/admin/provider-configs", async (request, reply) => {
      noStore(reply);
      const session = authenticateAdmin(request, reply, options, cookieName);
      if (!session) return;
      return { data: await providerManagement.list() };
    });
    app.put(
      "/api/admin/provider-configs/:providerId",
      { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        noStore(reply);
        const session = authenticateAdmin(request, reply, options, cookieName, true);
        if (!session) return;
        if (!sameOrigin(request)) {
          return adminError(reply, 403, "Provider request origin was rejected", "invalid_origin");
        }
        const params = request.params as { providerId?: string };
        const parsed = providerInputSchema.safeParse(request.body);
        if (
          !params.providerId ||
          !/^[a-z][a-z0-9_-]{1,31}$/u.test(params.providerId) ||
          params.providerId === "codex" ||
          !parsed.success
        ) {
          return adminError(
            reply,
            400,
            "Invalid provider configuration",
            "invalid_provider_config",
          );
        }
        try {
          const provider = await providerManagement.upsert({
            id: params.providerId,
            name: parsed.data.name,
            protocol: parsed.data.protocol,
            baseUrl: parsed.data.baseUrl,
            enabled: parsed.data.enabled,
            models: parsed.data.models,
            ...(parsed.data.apiKey !== undefined ? { apiKey: parsed.data.apiKey } : {}),
          });
          return { provider };
        } catch {
          return adminError(
            reply,
            400,
            "Provider configuration could not be applied",
            "provider_config_failed",
          );
        }
      },
    );
  }

  app.post("/api/admin/keys/:keyId/revoke", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    const params = request.params as { keyId?: string };
    if (!params.keyId || !options.keyStore.revoke(params.keyId)) {
      return adminError(reply, 404, "Key was not found", "key_not_found");
    }
    return { revoked: true };
  });

  app.patch("/api/admin/keys/:keyId", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    const params = request.params as { keyId?: string };
    const parsed = updateKeySchema.safeParse(request.body);
    if (!params.keyId || !parsed.success) {
      return adminError(reply, 400, "Invalid key policy update", "invalid_key_policy");
    }
    if (parsed.data.ipAllowlist) {
      try {
        validateIpAllowlist(parsed.data.ipAllowlist);
      } catch {
        return adminError(reply, 400, "Invalid IP or CIDR allowlist", "invalid_ip_allowlist");
      }
    }
    if (parsed.data.allowedModels && options.codexBackend) {
      const available = new Set((await options.codexBackend.listModels()).map((model) => model.id));
      const unknown = parsed.data.allowedModels.find((model) => !available.has(model));
      if (unknown) {
        return adminError(reply, 400, `Unknown or unavailable model: ${unknown}`, "invalid_model");
      }
    }
    const patch: UpdateMyTokenKeyPolicy = {};
    if (parsed.data.expiresAt !== undefined) patch.expiresAt = parsed.data.expiresAt;
    if (parsed.data.allowedModels !== undefined) patch.allowedModels = parsed.data.allowedModels;
    if (parsed.data.allowClientTools !== undefined) {
      patch.allowClientTools = parsed.data.allowClientTools;
    }
    if (parsed.data.rpmLimit !== undefined) patch.rpmLimit = parsed.data.rpmLimit;
    if (parsed.data.dailyRequestLimit !== undefined) {
      patch.dailyRequestLimit = parsed.data.dailyRequestLimit;
    }
    if (parsed.data.maxConcurrency !== undefined) {
      patch.maxConcurrency = parsed.data.maxConcurrency;
    }
    if (parsed.data.ipAllowlist !== undefined) patch.ipAllowlist = parsed.data.ipAllowlist;
    if (parsed.data.requestBudget !== undefined) patch.requestBudget = parsed.data.requestBudget;
    if (parsed.data.tokenBudget !== undefined) patch.tokenBudget = parsed.data.tokenBudget;
    if (!(await options.keyStore.updatePolicy(params.keyId, patch))) {
      return adminError(reply, 404, "Key was not found", "key_not_found");
    }
    return { updated: true };
  });

  if (options.codexBackend) registerCodexRoutes(app, options, cookieName);
}

function registerCodexRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions & { codexBackend?: CodexAdminBackend },
  cookieName: string,
): void {
  const backend = options.codexBackend;
  if (!backend) return;
  app.get("/api/admin/codex", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName);
    if (!session) return;
    const account = await backend.account();
    const [rateLimitsResult, usageResult] = await Promise.allSettled([
      backend.rateLimits(),
      backend.usage(),
    ]);
    return {
      account: normalizeAccount(account),
      rateLimits: normalizeRateLimits(
        rateLimitsResult.status === "fulfilled" ? rateLimitsResult.value : undefined,
      ),
      usage: normalizeUsage(usageResult.status === "fulfilled" ? usageResult.value : undefined),
    };
  });
  app.get("/api/admin/models", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName);
    if (!session) return;
    return { data: await backend.listModels() };
  });
  app.get("/api/admin/providers", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName);
    if (!session) return;
    return {
      data: backend.providerStatuses
        ? await backend.providerStatuses()
        : [
            {
              id: "codex",
              name: "Codex",
              protocol: "codex-app-server",
              enabled: true,
              ready: true,
              modelsCount: (await backend.listModels()).length,
              error: null,
            },
          ],
    };
  });
  app.post("/api/admin/codex/login", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    const account = normalizeAccount(await backend.account());
    if (account.connected === true) {
      return adminError(reply, 409, "Codex is already connected", "codex_already_connected");
    }
    return normalizeDeviceLogin(await backend.startDeviceLogin());
  });
  app.post("/api/admin/codex/login/cancel", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    const body = request.body;
    if (!isRecord(body) || typeof body.loginId !== "string") {
      return adminError(reply, 400, "loginId is required", "invalid_login_id");
    }
    return backend.cancelDeviceLogin(body.loginId);
  });
  app.post("/api/admin/codex/logout", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    return backend.logoutAccount();
  });
}

function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions,
  cookieName: string,
  requireCsrf = false,
): AuthenticatedAdminSession | undefined {
  const sessionToken = request.cookies[cookieName];
  if (!sessionToken) {
    adminError(reply, 401, "Administrator authentication required", "admin_auth_required");
    return undefined;
  }
  try {
    const authenticated = options.adminAuth.authenticate(sessionToken);
    if (requireCsrf) {
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string") throw new Error("Missing CSRF token");
      options.adminAuth.verifyCsrf(authenticated.session, csrf);
    }
    return authenticated;
  } catch {
    adminError(
      reply,
      requireCsrf ? 403 : 401,
      "Administrator request was rejected",
      "admin_request_rejected",
    );
    return undefined;
  }
}

function adminError(
  reply: FastifyReply,
  status: number,
  message: string,
  code: string,
): FastifyReply {
  noStore(reply);
  return reply.code(status).send(openAiError(message, code));
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

function fingerprint(value: string | undefined): string | null {
  return value ? createHash("sha256").update(value).digest("base64url") : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function normalizeAccount(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { connected: false, status: "unknown" };
  const account = isRecord(value.account) ? value.account : undefined;
  const type = account && typeof account.type === "string" ? account.type : null;
  const planType = account && typeof account.planType === "string" ? account.planType : null;
  const email = account && typeof account.email === "string" ? account.email : null;
  return {
    connected: Boolean(account),
    authMode: type,
    planType,
    emailMasked: email ? maskEmail(email) : null,
    requiresOpenaiAuth:
      typeof value.requiresOpenaiAuth === "boolean" ? value.requiresOpenaiAuth : null,
    observedAt: Date.now(),
  };
}

function normalizeRateLimits(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { available: false, observedAt: Date.now() };
  const limits = isRecord(value.rateLimits) ? value.rateLimits : undefined;
  const primary = limits && isRecord(limits.primary) ? limits.primary : undefined;
  const secondary = limits && isRecord(limits.secondary) ? limits.secondary : undefined;
  const byLimitId = isRecord(value.rateLimitsByLimitId)
    ? Object.fromEntries(
        Object.entries(value.rateLimitsByLimitId).map(([key, entry]) => [
          key,
          normalizeRateLimitBucket(entry),
        ]),
      )
    : {};
  return {
    available: Boolean(limits),
    primary: normalizeWindow(primary),
    secondary: normalizeWindow(secondary),
    byLimitId,
    resetCredits: normalizeResetCredits(value.rateLimitResetCredits),
    observedAt: Date.now(),
  };
}

function normalizeRateLimitBucket(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    limitId: typeof value.limitId === "string" ? value.limitId : null,
    limitName: typeof value.limitName === "string" ? value.limitName : null,
    planType: typeof value.planType === "string" ? value.planType : null,
    credits: typeof value.credits === "number" ? value.credits : null,
    rateLimitReachedType:
      typeof value.rateLimitReachedType === "string" ? value.rateLimitReachedType : null,
    primary: normalizeWindow(isRecord(value.primary) ? value.primary : undefined),
    secondary: normalizeWindow(isRecord(value.secondary) ? value.secondary : undefined),
  };
}

function normalizeResetCredits(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    availableCount: typeof value.availableCount === "number" ? value.availableCount : null,
  };
}

function normalizeUsage(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { available: false, summary: null, dailyUsageBuckets: null };
  const summary = isRecord(value.summary) ? value.summary : undefined;
  const buckets = Array.isArray(value.dailyUsageBuckets)
    ? value.dailyUsageBuckets.flatMap((entry) =>
        isRecord(entry) && typeof entry.startDate === "string" && typeof entry.tokens === "number"
          ? [{ startDate: entry.startDate, tokens: entry.tokens }]
          : [],
      )
    : null;
  return {
    available: Boolean(summary || buckets),
    summary: summary
      ? {
          lifetimeTokens: numberOrNull(summary.lifetimeTokens),
          peakDailyTokens: numberOrNull(summary.peakDailyTokens),
          longestRunningTurnSec: numberOrNull(summary.longestRunningTurnSec),
          currentStreakDays: numberOrNull(summary.currentStreakDays),
          longestStreakDays: numberOrNull(summary.longestStreakDays),
        }
      : null,
    dailyUsageBuckets: buckets,
    observedAt: Date.now(),
  };
}

function normalizeDeviceLogin(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    value.type !== "chatgptDeviceCode" ||
    typeof value.loginId !== "string" ||
    typeof value.verificationUrl !== "string" ||
    typeof value.userCode !== "string"
  ) {
    throw new Error("Codex returned an invalid device login response");
  }
  const url = new URL(value.verificationUrl);
  if (url.protocol !== "https:") throw new Error("Codex returned an unsafe login URL");
  return {
    type: "chatgptDeviceCode",
    loginId: value.loginId,
    verificationUrl: url.toString(),
    userCode: value.userCode,
  };
}

function normalizeWindow(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  return {
    usedPercent: typeof value.usedPercent === "number" ? value.usedPercent : null,
    windowDurationMins:
      typeof value.windowDurationMins === "number" ? value.windowDurationMins : null,
    resetsAt: typeof value.resetsAt === "number" ? value.resetsAt : null,
  };
}

function maskEmail(email: string): string {
  const separator = email.indexOf("@");
  if (separator <= 0) return "***";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyUsage(): {
  totalRequests: number;
  billableRequests: number;
  todayRequests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastRequestAt: null;
} {
  return {
    totalRequests: 0,
    billableRequests: 0,
    todayRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastRequestAt: null,
  };
}
