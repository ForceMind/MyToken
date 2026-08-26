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
  it("fetches the newest valid GitHub release tag with strict validation and caching", async () => {
    const paths = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: "not-a-release", commit: { sha: "f".repeat(40) } },
          { name: "v1.2.3-preview.3", commit: { sha: "a".repeat(40) } },
          { name: "v1.2.3-preview.4", commit: { sha: "b".repeat(40) } },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const service = new SystemUpdateService({ ...paths, fetchImpl });
    await expect(service.getLatestVersion()).resolves.toMatchObject({
      source: "github",
      repository: "ForceMind/MyToken",
      tag: "v1.2.3-preview.4",
      version: "1.2.3-preview.4",
      commitSha: "b".repeat(40),
    });
    await service.getLatestVersion();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/ForceMind/MyToken/tags?per_page=100"),
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects an insecure GitHub API and malformed tag response", async () => {
    const paths = await fixture();
    expect(
      () => new SystemUpdateService({ ...paths, githubApiUrl: "http://github.example" }),
    ).toThrow("HTTPS");
    const service = new SystemUpdateService({
      ...paths,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}")),
    });
    await expect(service.getLatestVersion()).rejects.toThrow("invalid shape");
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
