import { describe, expect, it, vi } from "vitest";

import { createGatewayResponse } from "@mytoken/openai-compat";

import type { CodexAdminBackend } from "../src/admin-routes.js";
import type { GatewayBackend } from "../src/app.js";
import type { ExternalProviderBackend } from "../src/external-provider-backends.js";
import {
  MultiProviderGatewayBackend,
  resolveProviderModel,
} from "../src/multi-provider-backend.js";

function codex(connected = true): GatewayBackend & CodexAdminBackend {
  return {
    isReady: () => true,
    probe: async () => true,
    listModels: async () => [{ id: "gpt-codex", displayName: "GPT Codex" }],
    createResponse: async (request) =>
      createGatewayResponse({ id: "resp-codex", model: request.model, output: [] }),
    account: async () => (connected ? { account: { type: "chatgpt" } } : { account: null }),
    rateLimits: async () => ({}),
    usage: async () => ({}),
    startDeviceLogin: async () => ({}),
    cancelDeviceLogin: async () => ({}),
    logoutAccount: async () => ({}),
  };
}

describe("MultiProviderGatewayBackend", () => {
  it("routes canonical external models and preserves bare Codex models", async () => {
    const createResponse = vi.fn(async (request) =>
      createGatewayResponse({ id: "resp-external", model: request.model, output: [] }),
    );
    const external: ExternalProviderBackend = {
      providerId: "deepseek",
      providerName: "DeepSeek",
      isReady: () => true,
      probe: async () => true,
      listModels: async () => [
        {
          id: "deepseek/deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          providerId: "deepseek",
        },
      ],
      createResponse,
    };
    const router = new MultiProviderGatewayBackend({
      codex: codex(),
      external: [{ backend: external, protocol: "openai-responses" }],
    });
    await expect(router.listModels()).resolves.toMatchObject([
      { id: "gpt-codex", providerId: "codex" },
      { id: "deepseek/deepseek-v4-flash", providerId: "deepseek" },
    ]);
    await router.createResponse(
      { model: "deepseek/deepseek-v4-flash", input: "hello" },
      { apiKeyId: "key" },
    );
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "deepseek/deepseek-v4-flash" }),
      { apiKeyId: "key" },
    );
  });

  it("fails closed for an unconfigured provider", async () => {
    const router = new MultiProviderGatewayBackend({ codex: codex() });
    await expect(
      router.createResponse({ model: "unknown/model", input: "hello" }, { apiKeyId: "key" }),
    ).rejects.toMatchObject({ code: "model_provider_not_configured" });
    expect(resolveProviderModel("gpt-codex")).toEqual({
      providerId: "codex",
      upstreamModel: "gpt-codex",
    });
  });

  it("does not report Codex ready when models are visible but the account is logged out", async () => {
    const router = new MultiProviderGatewayBackend({ codex: codex(false) });
    await expect(router.probe()).resolves.toBe(false);
    expect(router.isReady()).toBe(false);
    await expect(router.providerStatuses()).resolves.toMatchObject([
      {
        id: "codex",
        ready: false,
        modelsCount: 1,
        error: "codex_not_authenticated",
      },
    ]);
  });
});
