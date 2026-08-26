import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createMyTokenKey } from "@mytoken/key-auth";

import { ApiKeyRepository } from "../src/api-key-repository.js";
import { MyTokenDatabase } from "../src/database.js";
import { RequestLogRepository } from "../src/request-log-repository.js";

const databases: MyTokenDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("RequestLogRepository", () => {
  it("records request context, IP, response and aggregate usage", () => {
    const database = new MyTokenDatabase(":memory:");
    databases.push(database);
    database.migrate();
    const key = createMyTokenKey(randomBytes(32), { mode: "live", name: "desktop" }).record;
    new ApiKeyRepository(database).create(key);
    const logs = new RequestLogRepository(database);
    logs.begin({
      id: "log-1",
      requestId: "req-1",
      apiKeyId: key.id,
      method: "POST",
      path: "/v1/responses",
      model: "gpt-test",
      providerId: "codex",
      upstreamModel: "gpt-test",
      billable: true,
      startedAt: 1000,
      sourceIp: "203.0.113.8",
      userAgent: "fixture",
      requestBody: { input: "hello" },
    });
    logs.complete("log-1", {
      statusCode: 200,
      status: "completed",
      completedAt: 1250,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      responseBody: { output_text: "hi" },
    });

    expect(logs.usage(key.id, 2000)).toMatchObject({
      billableRequests: 1,
      successfulRequests: 1,
      totalTokens: 15,
    });
    expect(logs.list()).toMatchObject([
      {
        requestId: "req-1",
        keyName: "desktop",
        sourceIp: "203.0.113.8",
        latencyMs: 250,
        requestBody: { input: "hello" },
        responseBody: { output_text: "hi" },
      },
    ]);
  });
});
