import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { MyTokenError } from "@mytoken/shared";

const DEFAULT_PACKAGE = "mytoken-gateway";
const DEFAULT_DIST_TAG = "preview";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const MAX_STATUS_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface UpdateStatus {
  status: "idle" | "pending" | "running" | "success" | "failed";
  version: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

export interface LatestVersion {
  packageName: string;
  distTag: string;
  version: string;
  fetchedAt: string;
}

export interface UpdateRequest {
  id: string;
  requestedAt: string;
  source: "admin";
}

export interface SystemUpdateServiceOptions {
  packageName?: string;
  distTag?: string;
  registryUrl?: string;
  requestPath?: string;
  statusPath?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * API-side update coordination. It deliberately never executes a command.
 * The privileged systemd runner is the only component allowed to apply it.
 */
export class SystemUpdateService {
  readonly packageName: string;
  readonly distTag: string;
  readonly registryUrl: string;
  readonly requestPath: string;
  readonly statusPath: string;
  readonly currentVersion: string | null;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SystemUpdateServiceOptions = {}) {
    this.packageName = options.packageName ?? DEFAULT_PACKAGE;
    this.distTag = options.distTag ?? DEFAULT_DIST_TAG;
    this.registryUrl = options.registryUrl ?? DEFAULT_REGISTRY;
    this.requestPath = options.requestPath ?? "/var/lib/mytoken/api/update-request.json";
    this.statusPath = options.statusPath ?? "/var/lib/mytoken/update/status.json";
    this.currentVersion = options.currentVersion ?? null;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const parsed = new URL(this.registryUrl);
    if (parsed.protocol !== "https:") {
      throw new MyTokenError("update_registry_insecure", "Update registry must use HTTPS");
    }
  }

  async getLatestVersion(): Promise<LatestVersion> {
    const url = new URL(`/${encodeURIComponent(this.packageName)}`, `${this.registryUrl}/`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
      const contentLength = response.headers.get("content-length");
      if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 2_000_000)) {
        throw new Error("Registry response is too large");
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 2_000_000) {
        throw new Error("Registry response is too large");
      }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || !isRecord(parsed["dist-tags"])) {
        throw new Error("Registry response has an invalid shape");
      }
      const version = parsed["dist-tags"][this.distTag];
      if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
        throw new Error(`Registry has no valid ${this.distTag} version`);
      }
      return {
        packageName: this.packageName,
        distTag: this.distTag,
        version,
        fetchedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async readStatus(): Promise<UpdateStatus> {
    try {
      const text = await readFile(this.statusPath, "utf8");
      if (Buffer.byteLength(text, "utf8") > MAX_STATUS_BYTES)
        return emptyStatus("failed", "Status is too large");
      return sanitizeStatus(JSON.parse(text));
    } catch (error) {
      if (isNotFound(error)) return emptyStatus("idle", null);
      return emptyStatus("failed", "Unable to read update status");
    }
  }

  async requestUpdate(): Promise<UpdateRequest> {
    const status = await this.readStatus();
    if (status.status === "pending" || status.status === "running") {
      throw new MyTokenError("update_in_progress", "An update is already running");
    }
    await mkdir(dirname(this.requestPath), { recursive: true, mode: 0o750 });
    const request: UpdateRequest = {
      id: randomBytes(16).toString("hex"),
      requestedAt: new Date().toISOString(),
      source: "admin",
    };
    const temporaryPath = join(dirname(this.requestPath), `.${randomBytes(8).toString("hex")}.tmp`);
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload, "utf8") > MAX_REQUEST_BYTES)
      throw new Error("Update request is too large");
    try {
      await writeFile(temporaryPath, payload, { encoding: "utf8", flag: "wx", mode: 0o640 });
      // link() publishes the completed file without allowing a concurrent
      // request to replace an existing request file (rename() would do so).
      await link(temporaryPath, this.requestPath);
      await rm(temporaryPath, { force: true });
      return request;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (isAlreadyExists(error)) {
        throw new MyTokenError("update_in_progress", "An update is already pending");
      }
      throw error;
    }
  }
}

function emptyStatus(status: UpdateStatus["status"], message: string | null): UpdateStatus {
  return { status, version: null, requestedAt: null, startedAt: null, finishedAt: null, message };
}

function sanitizeStatus(value: unknown): UpdateStatus {
  if (!isRecord(value)) return emptyStatus("failed", "Invalid update status");
  const status = value.status;
  if (
    status !== "idle" &&
    status !== "pending" &&
    status !== "running" &&
    status !== "success" &&
    status !== "failed"
  ) {
    return emptyStatus("failed", "Invalid update status");
  }
  return {
    status,
    version: boundedString(value.version, 128),
    requestedAt: boundedString(value.requestedAt, 64),
    startedAt: boundedString(value.startedAt, 64),
    finishedAt: boundedString(value.finishedAt, 64),
    message: boundedString(value.message, 512),
  };
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
