import type { GatewayRequestLogRecord, KeyUsageSummary } from "@mytoken/shared";

import type { MyTokenDatabase } from "./database.js";

export interface BeginRequestLogInput {
  id: string;
  requestId: string;
  apiKeyId: string;
  method: string;
  path: string;
  model: string | null;
  providerId: string;
  upstreamModel: string | null;
  billable: boolean;
  startedAt: number;
  sourceIp: string;
  userAgent: string | null;
  requestBody: unknown;
}

export interface CompleteRequestLogInput {
  statusCode: number;
  status: "completed" | "failed";
  completedAt: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  errorCode?: string | null;
  responseBody?: unknown;
}

export class RequestLogRepository {
  constructor(readonly database: MyTokenDatabase) {}

  begin(input: BeginRequestLogInput): void {
    this.database.sqlite
      .prepare(
        `INSERT INTO request_logs
          (id, request_id, api_key_id, method, path, model, provider_id, upstream_model,
           billable, status_code, status,
           started_at, completed_at, latency_ms, input_tokens, output_tokens, total_tokens,
           error_code, source_ip, user_agent, request_body_json, response_body_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'in_progress', ?, NULL, NULL, NULL, NULL, NULL,
                 NULL, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.requestId,
        input.apiKeyId,
        input.method,
        input.path,
        input.model,
        input.providerId,
        input.upstreamModel,
        input.billable ? 1 : 0,
        input.startedAt,
        input.sourceIp,
        input.userAgent,
        safeJson(input.requestBody),
      );
  }

  complete(id: string, input: CompleteRequestLogInput): void {
    const row = this.database.sqlite
      .prepare("SELECT started_at AS startedAt FROM request_logs WHERE id = ?")
      .get(id) as { startedAt: number } | undefined;
    if (!row) return;
    this.database.sqlite
      .prepare(
        `UPDATE request_logs SET status_code = ?, status = ?, completed_at = ?, latency_ms = ?,
           input_tokens = ?, output_tokens = ?, total_tokens = ?, error_code = ?,
           response_body_json = ? WHERE id = ?`,
      )
      .run(
        input.statusCode,
        input.status,
        input.completedAt,
        Math.max(0, input.completedAt - row.startedAt),
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
        input.errorCode ?? null,
        input.responseBody === undefined ? null : safeJson(input.responseBody),
        id,
      );
  }

  recoverInterrupted(now = Date.now()): number {
    const result = this.database.sqlite
      .prepare(
        `UPDATE request_logs SET status = 'failed', status_code = 503, completed_at = ?,
           latency_ms = MAX(0, ? - started_at), error_code = 'gateway_restarted'
         WHERE status = 'in_progress'`,
      )
      .run(now, now);
    return Number(result.changes);
  }

  usage(apiKeyId: string, now = Date.now()): KeyUsageSummary {
    const today = startOfUtcDay(now);
    const row = this.database.sqlite
      .prepare(
        `SELECT
           COUNT(*) AS totalRequests,
           COALESCE(SUM(billable), 0) AS billableRequests,
           COALESCE(SUM(CASE WHEN billable = 1 AND started_at >= ? THEN 1 ELSE 0 END), 0) AS todayRequests,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS successfulRequests,
           COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedRequests,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(total_tokens), 0) AS totalTokens,
           MAX(started_at) AS lastRequestAt
         FROM request_logs WHERE api_key_id = ?`,
      )
      .get(today, apiKeyId) as unknown as UsageRow;
    return normalizeUsage(row);
  }

  list(
    options: { apiKeyId?: string; limit?: number; offset?: number } = {},
  ): GatewayRequestLogRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const where = options.apiKeyId ? "WHERE l.api_key_id = ?" : "";
    const statement = this.database.sqlite.prepare(
      `SELECT l.id, l.request_id AS requestId, l.api_key_id AS apiKeyId, k.name AS keyName,
         l.method, l.path, l.model, l.provider_id AS providerId,
         l.upstream_model AS upstreamModel, l.billable, l.status_code AS statusCode, l.status,
         l.started_at AS startedAt, l.completed_at AS completedAt, l.latency_ms AS latencyMs,
         l.input_tokens AS inputTokens, l.output_tokens AS outputTokens,
         l.total_tokens AS totalTokens, l.error_code AS errorCode, l.source_ip AS sourceIp,
         l.user_agent AS userAgent, l.request_body_json AS requestBodyJson,
         l.response_body_json AS responseBodyJson
       FROM request_logs l JOIN api_keys k ON k.id = l.api_key_id
       ${where} ORDER BY l.started_at DESC LIMIT ? OFFSET ?`,
    );
    const rows = (options.apiKeyId
      ? statement.all(options.apiKeyId, limit, offset)
      : statement.all(limit, offset)) as unknown as RequestLogRow[];
    return rows.map(toRequestLog);
  }
}

function startOfUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function safeJson(value: unknown): string {
  const encoded = JSON.stringify(value ?? null);
  return encoded.length <= 1024 * 1024 ? encoded : JSON.stringify({ truncated: true });
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { invalid: true };
  }
}

function normalizeUsage(row: UsageRow): KeyUsageSummary {
  return {
    totalRequests: Number(row.totalRequests),
    billableRequests: Number(row.billableRequests),
    todayRequests: Number(row.todayRequests),
    successfulRequests: Number(row.successfulRequests),
    failedRequests: Number(row.failedRequests),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    totalTokens: Number(row.totalTokens),
    lastRequestAt: row.lastRequestAt === null ? null : Number(row.lastRequestAt),
  };
}

function toRequestLog(row: RequestLogRow): GatewayRequestLogRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    apiKeyId: row.apiKeyId,
    keyName: row.keyName,
    method: row.method,
    path: row.path,
    model: row.model,
    providerId: row.providerId,
    upstreamModel: row.upstreamModel,
    billable: row.billable === 1,
    statusCode: row.statusCode,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    errorCode: row.errorCode,
    sourceIp: row.sourceIp,
    userAgent: row.userAgent,
    requestBody: parseJson(row.requestBodyJson),
    responseBody: parseJson(row.responseBodyJson),
  };
}

interface UsageRow {
  totalRequests: number;
  billableRequests: number;
  todayRequests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastRequestAt: number | null;
}

interface RequestLogRow {
  id: string;
  requestId: string;
  apiKeyId: string;
  keyName: string;
  method: string;
  path: string;
  model: string | null;
  providerId: string;
  upstreamModel: string | null;
  billable: number;
  statusCode: number | null;
  status: "in_progress" | "completed" | "failed";
  startedAt: number;
  completedAt: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  errorCode: string | null;
  sourceIp: string;
  userAgent: string | null;
  requestBodyJson: string;
  responseBodyJson: string | null;
}
