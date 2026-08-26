import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { MyTokenError } from "@mytoken/shared";

const DEFAULT_REPOSITORY = "ForceMind/MyToken";
const DEFAULT_GITHUB_API = "https://api.github.com";
const MAX_STATUS_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024;
const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/;

export interface UpdateStatus {
  status: "idle" | "pending" | "running" | "success" | "failed";
  version: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

export interface LatestVersion {
  source: "github";
  repository: string;
  tag: string;
  version: string;
  commitSha: string;
  fetchedAt: string;
}

export interface UpdateRequest {
  id: string;
  requestedAt: string;
  source: "admin";
}

export interface SystemUpdateServiceOptions {
  repository?: string;
  githubApiUrl?: string;
  requestPath?: string;
  statusPath?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheMs?: number;
}

/**
 * API-side update coordination. It deliberately never executes a command.
 * The privileged systemd runner is the only component allowed to apply it.
 */
export class SystemUpdateService {
  readonly repository: string;
  readonly githubApiUrl: string;
  readonly requestPath: string;
  readonly statusPath: string;
  readonly currentVersion: string | null;
  readonly timeoutMs: number;
  readonly cacheMs: number;
  private readonly fetchImpl: typeof fetch;
  private cachedLatest: { value: LatestVersion; expiresAt: number } | null = null;

  constructor(options: SystemUpdateServiceOptions = {}) {
    this.repository = options.repository ?? DEFAULT_REPOSITORY;
    this.githubApiUrl = options.githubApiUrl ?? DEFAULT_GITHUB_API;
    this.requestPath = options.requestPath ?? "/var/lib/mytoken/api/update-request.json";
    this.statusPath = options.statusPath ?? "/var/lib/mytoken/update/status.json";
    this.currentVersion = options.currentVersion ?? null;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.cacheMs = options.cacheMs ?? 5 * 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(this.repository)) {
      throw new MyTokenError("update_repository_invalid", "Update repository is invalid");
    }
    const parsed = new URL(this.githubApiUrl);
    if (parsed.protocol !== "https:") {
      throw new MyTokenError("update_source_insecure", "GitHub API must use HTTPS");
    }
  }

  async getLatestVersion(): Promise<LatestVersion> {
    if (this.cachedLatest && this.cachedLatest.expiresAt > Date.now()) {
      return this.cachedLatest.value;
    }
    const [owner, repository] = this.repository.split("/");
    const url = new URL(
      `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(repository ?? "")}/tags?per_page=100`,
      `${this.githubApiUrl}/`,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "mytoken-gateway",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const contentLength = response.headers.get("content-length");
      if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 1_000_000)) {
        throw new Error("GitHub response is too large");
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 1_000_000) {
        throw new Error("GitHub response is too large");
      }
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error("GitHub response has an invalid shape");
      }
      const releases = parsed.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.name !== "string" || !isRecord(entry.commit))
          return [];
        const match = RELEASE_TAG_PATTERN.exec(entry.name);
        const commitSha = entry.commit.sha;
        if (!match || typeof commitSha !== "string" || !/^[a-f0-9]{40}$/u.test(commitSha))
          return [];
        return [
          { tag: entry.name, version: entry.name.slice(1), commitSha, parts: releaseParts(match) },
        ];
      });
      releases.sort((left, right) => compareReleaseParts(right.parts, left.parts));
      const latest = releases[0];
      if (!latest) {
        throw new Error("GitHub has no valid MyToken release tag");
      }
      const value: LatestVersion = {
        source: "github",
        repository: this.repository,
        tag: latest.tag,
        version: latest.version,
        commitSha: latest.commitSha,
        fetchedAt: new Date().toISOString(),
      };
      this.cachedLatest = { value, expiresAt: Date.now() + this.cacheMs };
      return value;
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

type ReleaseParts = [major: number, minor: number, patch: number, preview: number | null];

function releaseParts(match: RegExpExecArray): ReleaseParts {
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : null];
}

function compareReleaseParts(left: ReleaseParts, right: ReleaseParts): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left[3] === null && right[3] !== null) return 1;
  if (left[3] !== null && right[3] === null) return -1;
  return (left[3] ?? 0) - (right[3] ?? 0);
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
