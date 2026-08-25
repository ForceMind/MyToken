import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkerSocketBackend } from "../src/worker-socket-backend.js";

const servers: http.Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true })),
  );
});

describe("WorkerSocketBackend", () => {
  it("uses a Unix socket and normalizes the fixed worker contract", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mytoken-worker-test-"));
    directories.push(directory);
    const socketPath = path.join(directory, "worker.sock");
    const server = http.createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/internal/health") {
        response.end(JSON.stringify({ status: "ready" }));
      } else if (request.url === "/internal/models") {
        response.end(JSON.stringify({ data: [{ id: "gpt-fixture", displayName: "Fixture" }] }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not_found" }));
      }
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const backend = new WorkerSocketBackend({ socketPath, requestTimeoutMs: 2_000 });
    await expect(backend.probe()).resolves.toBe(true);
    expect(backend.isReady()).toBe(true);
    await expect(backend.listModels()).resolves.toEqual([
      { id: "gpt-fixture", displayName: "Fixture" },
    ]);
  });
});
