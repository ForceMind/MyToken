import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexImportService } from "../src/codex-import-service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "mytoken-codex-import-"));
  directories.push(directory);
  return {
    directory,
    requestPath: join(directory, "api", "request.json"),
    statusPath: join(directory, "status", "status.json"),
  };
}

describe("CodexImportService", () => {
  it("creates one bounded request for a validated Linux user", async () => {
    const paths = await fixture();
    const service = new CodexImportService(paths);
    const request = await service.requestImport("root");
    expect(request).toMatchObject({ sourceUser: "root", source: "admin" });
    expect(JSON.parse(await readFile(paths.requestPath, "utf8"))).toMatchObject({
      sourceUser: "root",
    });
    await expect(service.requestImport("root")).rejects.toMatchObject({
      code: "codex_import_in_progress",
    });
  });

  it("rejects unsafe users and sanitizes root-owned status", async () => {
    const paths = await fixture();
    const service = new CodexImportService(paths);
    await expect(service.requestImport("../root")).rejects.toMatchObject({
      code: "invalid_linux_user",
    });
    await expect(service.readStatus()).resolves.toMatchObject({ status: "idle" });
    await mkdir(join(paths.directory, "status"), { recursive: true });
    await writeFile(
      paths.statusPath,
      JSON.stringify({
        status: "failed",
        sourceUser: "root",
        code: "credential_store_not_importable",
        message: "Use device login",
        ignored: "secret",
      }),
    );
    await expect(service.readStatus()).resolves.toEqual({
      status: "failed",
      sourceUser: "root",
      code: "credential_store_not_importable",
      requestedAt: null,
      startedAt: null,
      finishedAt: null,
      message: "Use device login",
    });
  });
});
