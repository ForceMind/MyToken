import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderManagementService } from "../src/provider-management-service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProviderManagementService", () => {
  it("stores an API key separately, reloads immediately, and never returns the key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mytoken-provider-management-"));
    directories.push(directory);
    const configPath = join(directory, "providers.json");
    const secretDirectory = join(directory, "secrets");
    await writeFile(configPath, '{"providers":[]}');
    const reload = vi.fn(async () => undefined);
    const service = new ProviderManagementService({ configPath, secretDirectory, reload });

    const configured = await service.upsert({
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai-chat",
      baseUrl: "https://api.deepseek.com",
      enabled: true,
      models: ["deepseek-chat"],
      apiKey: "sk-deepseek-secret",
    });

    expect(configured).toMatchObject({
      id: "deepseek",
      protocol: "openai-chat",
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(configured)).not.toContain("sk-deepseek-secret");
    expect(await readFile(join(secretDirectory, "deepseek"), "utf8")).toBe("sk-deepseek-secret");
    const storedConfig = await readFile(configPath, "utf8");
    expect(storedConfig).toContain(join(secretDirectory, "deepseek"));
    expect(storedConfig).not.toContain("sk-deepseek-secret");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("rejects insecure provider URLs before changing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mytoken-provider-management-"));
    directories.push(directory);
    const configPath = join(directory, "providers.json");
    await writeFile(configPath, '{"providers":[]}');
    const service = new ProviderManagementService({
      configPath,
      secretDirectory: join(directory, "secrets"),
      reload: async () => undefined,
    });
    await expect(
      service.upsert({
        id: "local",
        name: "Local",
        protocol: "openai-responses",
        baseUrl: "http://127.0.0.1:9000",
        enabled: true,
        models: [],
        apiKey: "local-secret",
      }),
    ).rejects.toMatchObject({ code: "provider_config_insecure_url" });
  });
});
