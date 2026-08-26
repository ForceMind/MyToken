import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadExternalProviderConfiguration } from "../src/provider-config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true })),
  );
});

describe("provider configuration", () => {
  it("loads secrets separately and reports missing provider keys without exposing them", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mytoken-provider-config-"));
    directories.push(directory);
    const secret = path.join(directory, "deepseek.key");
    const config = path.join(directory, "providers.json");
    await writeFile(secret, "secret-provider-key", { mode: 0o600 });
    await writeFile(
      config,
      JSON.stringify({
        providers: [
          {
            id: "deepseek",
            name: "DeepSeek",
            protocol: "openai-responses",
            baseUrl: "https://api.deepseek.com",
            apiKeyFile: secret,
          },
          {
            id: "anthropic",
            name: "Claude",
            protocol: "anthropic",
            baseUrl: "https://api.anthropic.com",
            apiKeyFile: path.join(directory, "missing.key"),
          },
        ],
      }),
    );
    const loaded = await loadExternalProviderConfiguration(config);
    expect(loaded.active).toMatchObject([{ id: "deepseek", apiKey: "secret-provider-key" }]);
    expect(loaded.statuses).toMatchObject([
      { id: "deepseek", enabled: true },
      { id: "anthropic", enabled: false, reason: "api_key_file_missing" },
    ]);
    expect(JSON.stringify(loaded.statuses)).not.toContain("secret-provider-key");
  });

  it("rejects insecure provider URLs by default", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mytoken-provider-config-"));
    directories.push(directory);
    const config = path.join(directory, "providers.json");
    await writeFile(
      config,
      JSON.stringify({
        providers: [
          {
            id: "local",
            name: "Local",
            protocol: "openai-responses",
            baseUrl: "http://127.0.0.1:9000",
            apiKeyFile: path.join(directory, "key"),
          },
        ],
      }),
    );
    await expect(loadExternalProviderConfiguration(config)).rejects.toMatchObject({
      code: "provider_config_insecure_url",
    });
  });
});
