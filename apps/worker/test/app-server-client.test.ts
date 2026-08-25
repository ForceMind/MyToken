import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerClient } from "../src/app-server/client.js";
import { OpenClawToolBroker, type ToolCallEvent } from "../src/tool-bridge/openclaw-tool-broker.js";

const fixturePath = fileURLToPath(new URL("./fixtures/mock-app-server.mjs", import.meta.url));
const clients: CodexAppServerClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
});

async function createClient(): Promise<CodexAppServerClient> {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    requestTimeoutMs: 2_000,
  });
  clients.push(client);
  await client.start({
    clientInfo: {
      name: "mytoken_gateway_test",
      title: "MyToken Gateway Test",
      version: "0.1.0",
    },
    experimentalApi: true,
  });
  return client;
}

describe("CodexAppServerClient", () => {
  it("initializes and correlates a normal request", async () => {
    const client = await createClient();
    await expect(client.request("test/echo", { ok: true })).resolves.toEqual({ ok: true });
    expect(client.state).toBe("ready");
    expect(client.generation).toBe(1);
  });

  it("bridges an app-server dynamic tool request without executing it", async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: [fixturePath],
      requestTimeoutMs: 2_000,
    });
    clients.push(client);
    const broker = new OpenClawToolBroker({ resultTimeoutMs: 2_000 });
    broker.attach(client);
    await client.start({
      clientInfo: {
        name: "mytoken_gateway_test",
        title: "MyToken Gateway Test",
        version: "0.1.0",
      },
      experimentalApi: true,
    });

    const toolEventPromise = once(broker, "toolCall");
    const responsePromise = client.request<{ toolResult: unknown }>("test/toolRoundTrip", {});
    const [eventValue] = await toolEventPromise;
    const event = eventValue as ToolCallEvent;

    expect(event).toMatchObject({
      tool: "fixture_weather",
      arguments: { city: "Shanghai" },
      threadId: "thread-fixture",
      turnId: "turn-fixture",
    });
    expect(broker.pendingCount).toBe(1);

    broker.resolve(event.callId, event.generation, {
      success: true,
      contentItems: [{ type: "inputText", text: "25 C" }],
    });

    await expect(responsePromise).resolves.toEqual({
      toolResult: {
        success: true,
        contentItems: [{ type: "inputText", text: "25 C" }],
      },
    });
    expect(broker.pendingCount).toBe(0);
  });
});
