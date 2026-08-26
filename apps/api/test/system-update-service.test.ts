import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemUpdateService } from "../src/system-update-service.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "mytoken-update-"));
  directories.push(directory);
  return {
    directory,
    requestPath: join(directory, "api", "update-request.json"),
    statusPath: join(directory, "update", "status.json"),
  };
}

describe("SystemUpdateService", () => {
  it("fetches only the preview dist-tag with strict validation", async () => {
    const paths = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ "dist-tags": { preview: "1.2.3-preview.4" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const service = new SystemUpdateService({ ...paths, fetchImpl });
    await expect(service.getLatestVersion()).resolves.toMatchObject({ version: "1.2.3-preview.4" });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://registry.npmjs.org/mytoken-gateway"),
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects an insecure registry and malformed registry response", async () => {
    const paths = await fixture();
    expect(
      () => new SystemUpdateService({ ...paths, registryUrl: "http://registry.example" }),
    ).toThrow("HTTPS");
    const service = new SystemUpdateService({
      ...paths,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{"dist-tags":{}}')),
    });
    await expect(service.getLatestVersion()).rejects.toThrow("valid preview version");
  });

  it("returns bounded safe status and idle when it does not exist", async () => {
    const paths = await fixture();
    const service = new SystemUpdateService(paths);
    await expect(service.readStatus()).resolves.toMatchObject({ status: "idle" });
    await mkdir(join(paths.directory, "update"), { recursive: true });
    await writeFile(
      paths.statusPath,
      JSON.stringify({ status: "running", message: "ok", extra: "ignored" }),
      {
        encoding: "utf8",
      },
    );
    await expect(service.readStatus()).resolves.toMatchObject({ status: "running", message: "ok" });
  });

  it("atomically creates one request and rejects a concurrent second request", async () => {
    const paths = await fixture();
    const service = new SystemUpdateService(paths);
    const results = await Promise.allSettled([service.requestUpdate(), service.requestUpdate()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const request = JSON.parse(await readFile(paths.requestPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(request.source).toBe("admin");
    expect(Object.keys(request).sort()).toEqual(["id", "requestedAt", "source"]);
  });
});
