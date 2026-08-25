import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { AdminAuthService } from "@mytoken/admin-auth";
import { AdminAuthRepository, ApiKeyRepository, MyTokenDatabase } from "@mytoken/database";
import { createGatewayResponse } from "@mytoken/openai-compat";

import type { CodexAdminBackend } from "../src/admin-routes.js";
import { createApiApp, type GatewayBackend } from "../src/app.js";

const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];
const databases: MyTokenDatabase[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const database of databases.splice(0)) database.close();
});

const backend: GatewayBackend & CodexAdminBackend = {
  isReady: () => true,
  listModels: async () => [{ id: "gpt-fixture", displayName: "GPT Fixture" }],
  createResponse: async (request) =>
    createGatewayResponse({ id: "resp-admin-test", model: request.model, output: [] }),
  account: async () => ({
    account: { type: "chatgpt", email: "admin@example.com", planType: "plus" },
    requiresOpenaiAuth: true,
  }),
  rateLimits: async () => ({
    rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 2_000 } },
  }),
  startDeviceLogin: async () => ({
    type: "chatgptDeviceCode",
    loginId: "login-test",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "TEST-CODE",
  }),
  cancelDeviceLogin: async () => ({}),
  logoutAccount: async () => ({}),
};

describe("administrator API", () => {
  it("bootstraps once, logs in, enforces CSRF, and creates a usable key", async () => {
    const database = new MyTokenDatabase(":memory:");
    databases.push(database);
    database.migrate();
    const adminAuth = new AdminAuthService(new AdminAuthRepository(database), randomBytes(32));
    const bootstrap = adminAuth.createBootstrapToken();
    adminAuth.installBootstrapToken(bootstrap);
    const keyStore = new ApiKeyRepository(database);
    const keyPepper = randomBytes(32);
    const app = await createApiApp({
      backend,
      keyStore,
      keyManagementStore: keyStore,
      keyPepper,
      adminAuth,
      codexAdminBackend: backend,
      cookieSecure: false,
    });
    apps.push(app);

    const setup = await app.inject({
      method: "POST",
      url: "/api/admin/setup",
      payload: {
        bootstrapToken: bootstrap.plaintext,
        username: "admin",
        password: "correct horse battery staple",
      },
    });
    expect(setup.statusCode).toBe(201);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/admin/setup",
      payload: {
        bootstrapToken: bootstrap.plaintext,
        username: "other",
        password: "another correct password",
      },
    });
    expect(repeated.statusCode).toBe(409);

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { username: "admin", password: "correct horse battery staple" },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json();
    const setCookie = login.headers["set-cookie"];
    if (typeof setCookie !== "string") throw new Error("Expected session cookie");
    const sessionCookie = setCookie.split(";", 1)[0];
    if (!sessionCookie) throw new Error("Expected session cookie value");

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/admin/keys",
      headers: { cookie: sessionCookie },
      payload: { mode: "test", name: "OpenClaw" },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const codex = await app.inject({
      method: "GET",
      url: "/api/admin/codex",
      headers: { cookie: sessionCookie },
    });
    expect(codex.statusCode).toBe(200);
    expect(codex.body).not.toContain("admin@example.com");
    expect(codex.json()).toMatchObject({
      account: { connected: true, emailMasked: "a***@example.com", planType: "plus" },
      rateLimits: { available: true, primary: { usedPercent: 10 } },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/keys",
      headers: {
        cookie: sessionCookie,
        "x-csrf-token": loginBody.csrfToken,
      },
      payload: {
        mode: "test",
        name: "OpenClaw",
        allowedModels: ["gpt-fixture"],
        allowClientTools: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const plaintextKey = created.json().key;

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/keys",
      headers: { cookie: sessionCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(plaintextKey);
    expect(listed.json()).toMatchObject({ data: [{ name: "OpenClaw" }] });

    const models = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${plaintextKey}` },
    });
    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({ data: [{ id: "gpt-fixture" }] });

    const logout = await app.inject({
      method: "POST",
      url: "/api/admin/logout",
      headers: { cookie: sessionCookie, "x-csrf-token": loginBody.csrfToken },
    });
    expect(logout.statusCode).toBe(204);
    const sessionAfterLogout = await app.inject({
      method: "GET",
      url: "/api/admin/session",
      headers: { cookie: sessionCookie },
    });
    expect(sessionAfterLogout.statusCode).toBe(401);
  });
});
