export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class MyTokenError extends Error {
  readonly originalCause: unknown;

  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "MyTokenError";
    this.originalCause = cause;
  }
}

const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+-]+/giu,
  /\b(?:sk|myt_live|myt_test)_[A-Za-z0-9_-]+\b/gu,
  /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/gu,
];

export function redactText(value: string): string {
  let redacted = value;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export interface KeyUsageSummary {
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

export interface GatewayRequestLogRecord {
  id: string;
  requestId: string;
  apiKeyId: string;
  keyName: string;
  method: string;
  path: string;
  model: string | null;
  providerId: string;
  upstreamModel: string | null;
  billable: boolean;
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
  requestBody: unknown;
  responseBody: unknown;
}
