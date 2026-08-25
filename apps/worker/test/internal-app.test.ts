import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerClient } from "../src/app-server/client.js";
import { CodexResponseCoordinator } from "../src/gateway/codex-response-coordinator.js";
import { createWorkerInternalApp } from "../src/internal-app.js";
import { OpenClawToolBroker } from "../src/tool-bridge/openclaw-tool-broker.js";

const fixturePath = fileURLToPath(new URL("./fixtures/mock-app-server.mjs", import.meta.url));
const resources: Array<{
  client: CodexAppServerClient;
  app: ReturnType<typeof createWorkerInternalApp>;
}> = [];

afterEach(async () => {
  const closing = resources.splice(0);
  await Promise.all(closing.map(async ({ app }) => app.close()));
  for (const { client } of closing) client.stop();
});

async function setup(): Promise<ReturnType<typeof createWorkerInternalApp>> {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    requestTimeoutMs: 2_000,
  });
  const broker = new OpenClawToolBroker({ resultTimeoutMs: 2_000 });
  broker.attach(client);
  const coordinator = new CodexResponseCoordinator(client, broker, { responseTimeoutMs: 2_000 });
  await client.start({
    clientInfo: { name: "mytoken_test", title: "MyToken Test", version: "0.1.0" },
    experimentalApi: true,
  });
  const app = createWorkerInternalApp({ client, coordinator, version: "0.1.0" });
  resources.push({ client, app });
  return app;
}

describe("worker internal API", () => {
  it("exposes only normalized fixed routes", async () => {
    const app = await setup();
    const health = await app.inject({ method: "GET", url: "/internal/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ready", generation: 1 });

    const arbitrary = await app.inject({ method: "POST", url: "/internal/json-rpc" });
    expect(arbitrary.statusCode).toBe(404);
  });

  it("runs the OpenClaw tool loop across two internal requests", async () => {
    const app = await setup();
    const first = await app.inject({
      method: "POST",
      url: "/internal/responses",
      payload: {
        apiKeyId: "key-openclaw",
        request: {
          model: "gpt-fixture",
          input: "Weather?",
          tools: [{ type: "function", name: "weather" }],
        },
      },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    const call = firstBody.output[0];
    expect(call).toMatchObject({ type: "function_call", name: "weather" });

    const second = await app.inject({
      method: "POST",
      url: "/internal/responses",
      payload: {
        apiKeyId: "key-openclaw",
        request: {
          model: "gpt-fixture",
          previous_response_id: firstBody.id,
          input: [{ type: "function_call_output", call_id: call.call_id, output: "25 C" }],
        },
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ output_text: "Weather is 25 C" });
  });
});
