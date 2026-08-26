import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createResponseRequestSchema } from "@mytoken/openai-compat";

import { CodexAppServerClient } from "../src/app-server/client.js";
import { CodexResponseCoordinator } from "../src/gateway/codex-response-coordinator.js";
import { OpenClawToolBroker } from "../src/tool-bridge/openclaw-tool-broker.js";

const fixturePath = fileURLToPath(new URL("./fixtures/mock-app-server.mjs", import.meta.url));
const clients: CodexAppServerClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
});

async function setup(): Promise<CodexResponseCoordinator> {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    requestTimeoutMs: 10_000,
  });
  clients.push(client);
  const broker = new OpenClawToolBroker({ resultTimeoutMs: 10_000 });
  broker.attach(client);
  const coordinator = new CodexResponseCoordinator(client, broker, {
    responseTimeoutMs: 10_000,
    enableClientTools: true,
  });
  await client.start({
    clientInfo: {
      name: "mytoken_gateway_test",
      title: "MyToken Gateway Test",
      version: "0.1.0",
    },
    experimentalApi: true,
  });
  return coordinator;
}

describe("CodexResponseCoordinator", () => {
  it("completes an OpenClaw function call and resumes the same turn", async () => {
    const coordinator = await setup();
    const first = await coordinator.createResponse(
      createResponseRequestSchema.parse({
        model: "gpt-fixture",
        input: "What is the weather in Shanghai?",
        tools: [
          {
            type: "function",
            name: "weather",
            description: "Get weather",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
      }),
      { apiKeyId: "key-openclaw" },
    );

    expect(first.output[0]).toMatchObject({
      type: "function_call",
      name: "weather",
      arguments: '{"city":"Shanghai"}',
    });
    const call = first.output[0];
    if (!call || call.type !== "function_call") throw new Error("Expected function call");

    const second = await coordinator.createResponse(
      createResponseRequestSchema.parse({
        model: "gpt-fixture",
        previous_response_id: first.id,
        input: [
          {
            type: "function_call_output",
            call_id: call.call_id,
            output: "25 C",
          },
        ],
      }),
      { apiKeyId: "key-openclaw" },
    );

    expect(second.status).toBe("completed");
    expect(second.output_text).toBe("Weather is 25 C");
    expect(second.usage).toEqual({ input_tokens: 12, output_tokens: 5, total_tokens: 17 });
  });

  it("lists normalized models", async () => {
    const coordinator = await setup();
    await expect(coordinator.listModels()).resolves.toEqual([
      { id: "gpt-fixture", displayName: "GPT Fixture" },
    ]);
  });
});
