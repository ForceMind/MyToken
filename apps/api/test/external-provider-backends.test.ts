import { describe, expect, it, vi } from "vitest";

import {
  AnthropicMessagesProviderBackend,
  OpenAIResponsesProviderBackend,
  createDeepSeekBackend,
} from "../src/external-provider-backends.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("external provider backends", () => {
  it("lists prefixed DeepSeek models and strips the prefix on responses", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: [{ id: "deepseek-chat", name: "DeepSeek Chat" }] }))
      .mockResolvedValueOnce(
        response({
          id: "resp_ds",
          output: [
            { type: "reasoning", id: "r1" },
            { type: "message", id: "m1", content: [{ type: "output_text", text: "hello" }] },
          ],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
      );
    const backend = createDeepSeekBackend("sk-test", { fetch: fetcher });
    await expect(backend.listModels()).resolves.toMatchObject([
      {
        id: "deepseek/deepseek-chat",
        displayName: "DeepSeek Chat",
        providerId: "deepseek",
      },
    ]);
    const result = await backend.createResponse(
      { model: "deepseek/deepseek-chat", input: "hi" },
      { apiKeyId: "key" },
    );
    expect(result.output_text).toBe("hello");
    expect(result.output.some((item) => item.type === "reasoning")).toBe(false);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).model).toBe("deepseek-chat");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer sk-test",
    );
  });

  it("converts Anthropic messages and preserves real usage", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ data: [{ id: "claude-sonnet", display_name: "Claude Sonnet" }] }),
      )
      .mockResolvedValueOnce(
        response({
          id: "msg_1",
          content: [{ type: "text", text: "answer" }],
          usage: { input_tokens: 9, output_tokens: 3 },
        }),
      );
    const backend = new AnthropicMessagesProviderBackend({
      id: "anthropic",
      name: "Anthropic",
      apiKey: "ant-key",
      fetch: fetcher,
    });
    await expect(backend.listModels()).resolves.toMatchObject([
      {
        id: "anthropic/claude-sonnet",
        displayName: "Claude Sonnet",
        providerId: "anthropic",
      },
    ]);
    const result = await backend.createResponse(
      {
        model: "anthropic/claude-sonnet",
        instructions: "Be concise",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "question" }] },
        ],
      },
      { apiKeyId: "key" },
    );
    expect(result.output_text).toBe("answer");
    expect(result.usage).toEqual({ input_tokens: 9, output_tokens: 3, total_tokens: 12 });
    const init = fetcher.mock.calls[1]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("ant-key");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "claude-sonnet",
      system: "Be concise",
      max_tokens: 4096,
    });
  });

  it("rejects unsupported Anthropic tools and previous-response state", async () => {
    const backend = new AnthropicMessagesProviderBackend({
      id: "anthropic",
      name: "Anthropic",
      apiKey: "key",
      fetch: vi.fn(),
    });
    await expect(
      backend.createResponse(
        { model: "anthropic/x", input: "hi", previous_response_id: "old" },
        { apiKeyId: "key" },
      ),
    ).rejects.toMatchObject({ code: "anthropic_feature_unsupported" });
  });

  it("redacts provider errors and enforces response size", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ error: "Bearer sk-secret" }, 401));
    const backend = new OpenAIResponsesProviderBackend({
      id: "custom",
      name: "Custom",
      baseUrl: "https://provider.test",
      apiKey: "key",
      fetch: fetcher,
    });
    await expect(backend.listModels()).rejects.toMatchObject({
      code: "provider_request_failed",
      message: expect.not.stringContaining("sk-secret"),
    });
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(response({ data: "x".repeat(2000) }));
    const bounded = new OpenAIResponsesProviderBackend({
      id: "custom",
      name: "Custom",
      baseUrl: "https://provider.test",
      apiKey: "key",
      maxResponseBytes: 1024,
      fetch: oversized,
    });
    await expect(bounded.listModels()).rejects.toMatchObject({
      code: "provider_response_too_large",
    });
  });
});
