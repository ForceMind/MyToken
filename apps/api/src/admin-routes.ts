import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AdminAuthService, type AuthenticatedAdminSession } from "@mytoken/admin-auth";
import {
  createMyTokenKey,
  type MyTokenKeyRecord,
  type CreateMyTokenKeyOptions,
} from "@mytoken/key-auth";
import { openAiError } from "@mytoken/openai-compat";

import type { ApiKeyStore } from "./app.js";

export interface ApiKeyManagementStore extends ApiKeyStore {
  create(record: MyTokenKeyRecord): void;
  revoke(keyId: string, now?: number): boolean;
  list(): Promise<readonly MyTokenKeyRecord[]>;
}

export interface CodexAdminBackend {
  account(): Promise<unknown>;
  rateLimits(): Promise<unknown>;
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
    };
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
      name: created.record.name,
      prefix: created.record.prefix,
      expiresAt: created.record.expiresAt,
      allowedModels: created.record.allowedModels,
      allowClientTools: created.record.allowClientTools,
    });
  });

  app.get("/api/admin/keys", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName);
    if (!session) return;
    const records = await options.keyStore.list();
    return {
      data: records.map((record) => ({
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
      })),
    };
  });

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
    const [account, rateLimits] = await Promise.all([backend.account(), backend.rateLimits()]);
    return { account: normalizeAccount(account), rateLimits: normalizeRateLimits(rateLimits) };
  });
  app.post("/api/admin/codex/login", async (request, reply) => {
    noStore(reply);
    const session = authenticateAdmin(request, reply, options, cookieName, true);
    if (!session) return;
    return backend.startDeviceLogin();
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
  return {
    available: Boolean(limits),
    primary: normalizeWindow(primary),
    secondary: normalizeWindow(secondary),
    observedAt: Date.now(),
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
