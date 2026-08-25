import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createMyTokenKey, revokeMyTokenKey } from "@mytoken/key-auth";
import { createGatewayResponse, type GatewayResponse } from "@mytoken/openai-compat";

import { createApiApp, type GatewayBackend } from "../src/app.js";
import { MemoryApiKeyStore } from "../src/memory-key-store.js";

const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function backend(response: GatewayResponse): GatewayBackend {
  return {
    isReady: () => true,
    listModels: async () => [
      { id: "gpt-allowed", displayName: "Allowed" },
      { id: "gpt-hidden-by-key", displayName: "Hidden by key" },
    ],
    createResponse: async () => response,
  };
}

describe("public API", () => {
  it("authenticates a key and filters models by policy", async () => {
    const pepper = randomBytes(32);
    const key = createMyTokenKey(pepper, {
      mode: "test",
      name: "OpenClaw",
      allowedModels: ["gpt-allowed"],
      allowClientTools: true,
    });
    const app = await createApiApp({
      backend: backend(createGatewayResponse({ id: "resp-1", model: "gpt-allowed", output: [] })),
      keyStore: new MemoryApiKeyStore([key.record]),
      keyPepper: pepper,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [{ id: "gpt-allowed" }] });
  });

  it("returns an OpenClaw-compatible streamed function call", async () => {
    const pepper = randomBytes(32);
    const key = createMyTokenKey(pepper, {
      mode: "test",
      name: "OpenClaw",
      allowedModels: ["gpt-allowed"],
      allowClientTools: true,
    });
    const toolResponse = createGatewayResponse({
      id: "resp-tool",
      model: "gpt-allowed",
      output: [
        {
          type: "function_call",
          id: "fc-1",
          call_id: "call-1",
          name: "weather",
          arguments: '{"city":"Shanghai"}',
          status: "completed",
        },
      ],
    });
    const app = await createApiApp({
      backend: backend(toolResponse),
      keyStore: new MemoryApiKeyStore([key.record]),
      keyPepper: pepper,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: `Bearer ${key.plaintext}` },
      payload: {
        model: "gpt-allowed",
        input: "What is the weather?",
        stream: true,
        tools: [
          {
            type: "function",
            name: "weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("response.function_call_arguments.delta");
    expect(response.body).toContain('"call_id":"call-1"');
    expect(response.body).toContain("response.completed");
  });

  it("rejects client tools when the key policy disables them", async () => {
    const pepper = randomBytes(32);
    const key = createMyTokenKey(pepper, {
      mode: "test",
      name: "Text only",
      allowedModels: ["gpt-allowed"],
      allowClientTools: false,
    });
    const app = await createApiApp({
      backend: backend(createGatewayResponse({ id: "resp-1", model: "gpt-allowed", output: [] })),
      keyStore: new MemoryApiKeyStore([key.record]),
      keyPepper: pepper,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: `Bearer ${key.plaintext}` },
      payload: {
        model: "gpt-allowed",
        input: "Use a tool",
        tools: [{ type: "function", name: "weather" }],
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "client_tools_not_allowed" } });
  });

  it("rejects a revoked key without revealing whether it existed", async () => {
    const pepper = randomBytes(32);
    const key = createMyTokenKey(pepper, { mode: "test", name: "Revoked" });
    const store = new MemoryApiKeyStore([revokeMyTokenKey(key.record)]);
    const app = await createApiApp({
      backend: backend(createGatewayResponse({ id: "resp-1", model: "gpt-allowed", output: [] })),
      keyStore: store,
      keyPepper: pepper,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${key.plaintext}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "invalid_api_key" } });
  });
});
