import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { MyTokenError } from "@mytoken/shared";

const MAX_STATUS_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024;
export const linuxUsernamePattern = /^[a-z_][a-z0-9_.-]{0,63}$/u;

export interface CodexImportStatus {
  status: "idle" | "pending" | "running" | "success" | "failed";
  sourceUser: string | null;
  code: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

export interface CodexImportRequest {
  id: string;
  sourceUser: string;
  requestedAt: string;
  source: "admin";
}

export interface CodexImportServiceOptions {
  requestPath?: string;
  statusPath?: string;
}

/** Coordinates an explicit import request; only the root systemd helper reads user homes. */
export class CodexImportService {
  readonly requestPath: string;
  readonly statusPath: string;

  constructor(options: CodexImportServiceOptions = {}) {
    this.requestPath = options.requestPath ?? "/var/lib/mytoken/api/codex-import-request.json";
    this.statusPath = options.statusPath ?? "/var/lib/mytoken/codex-import/status.json";
  }

  async readStatus(): Promise<CodexImportStatus> {
    try {
      const text = await readFile(this.statusPath, "utf8");
      if (Buffer.byteLength(text, "utf8") > MAX_STATUS_BYTES) {
        return emptyStatus("failed", "status_too_large", "Import status is too large");
      }
      return sanitizeStatus(JSON.parse(text));
    } catch (error) {
      if (isCode(error, "ENOENT")) return emptyStatus("idle", null, null);
      return emptyStatus("failed", "status_unreadable", "Unable to read import status");
    }
  }

  async requestImport(sourceUser: string): Promise<CodexImportRequest> {
    if (!linuxUsernamePattern.test(sourceUser) || sourceUser === "mytoken-codex") {
      throw new MyTokenError("invalid_linux_user", "Linux source user is invalid");
    }
    const status = await this.readStatus();
    if (status.status === "pending" || status.status === "running") {
      throw new MyTokenError("codex_import_in_progress", "A Codex import is already running");
    }
    await mkdir(dirname(this.requestPath), { recursive: true, mode: 0o700 });
    const request: CodexImportRequest = {
      id: randomBytes(16).toString("hex"),
      sourceUser,
      requestedAt: new Date().toISOString(),
      source: "admin",
    };
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error("Codex import request is too large");
    }
    const temporary = join(dirname(this.requestPath), `.${randomBytes(8).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await link(temporary, this.requestPath);
      await rm(temporary, { force: true });
      return request;
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (isCode(error, "EEXIST") || isCode(error, "ENOTEMPTY")) {
        throw new MyTokenError("codex_import_in_progress", "A Codex import is already pending");
      }
      throw error;
    }
  }
}

function sanitizeStatus(value: unknown): CodexImportStatus {
  if (!isRecord(value)) return emptyStatus("failed", "invalid_status", "Invalid import status");
  const status = value.status;
  if (
    status !== "idle" &&
    status !== "pending" &&
    status !== "running" &&
    status !== "success" &&
    status !== "failed"
  ) {
    return emptyStatus("failed", "invalid_status", "Invalid import status");
  }
  return {
    status,
    sourceUser: boundedString(value.sourceUser, 64),
    code: boundedString(value.code, 128),
    requestedAt: boundedString(value.requestedAt, 64),
    startedAt: boundedString(value.startedAt, 64),
    finishedAt: boundedString(value.finishedAt, 64),
    message: boundedString(value.message, 512),
  };
}

function emptyStatus(
  status: CodexImportStatus["status"],
  code: string | null,
  message: string | null,
): CodexImportStatus {
  return {
    status,
    sourceUser: null,
    code,
    requestedAt: null,
    startedAt: null,
    finishedAt: null,
    message,
  };
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function isCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
