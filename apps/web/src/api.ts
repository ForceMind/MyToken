const csrfStorageKey = "mytoken.csrf";
export const adminSessionInvalidEvent = "mytoken:admin-session-invalid";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const csrf = sessionStorage.getItem(csrfStorageKey);
  if (csrf && init.method && !["GET", "HEAD"].includes(init.method)) {
    headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = response.status === 204 ? undefined : ((await response.json()) as unknown);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    const code = error && typeof error.code === "string" ? error.code : undefined;
    if (response.status === 401 || code === "admin_request_rejected") {
      sessionStorage.removeItem(csrfStorageKey);
      window.dispatchEvent(new Event(adminSessionInvalidEvent));
    }
    throw new ApiError(
      response.status,
      error && typeof error.message === "string" ? error.message : "Request failed",
      code,
    );
  }
  return body as T;
}

export const api = {
  setupStatus: () => request<{ initialized: boolean }>("/api/admin/setup/status"),
  setup: (input: { bootstrapToken: string; username: string; password: string }) =>
    request<{ user: { id: string; username: string } }>("/api/admin/setup", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  login: async (input: { username: string; password: string }) => {
    const result = await request<{
      user: { id: string; username: string };
      csrfToken: string;
      expiresAt: number;
    }>("/api/admin/login", { method: "POST", body: JSON.stringify(input) });
    sessionStorage.setItem(csrfStorageKey, result.csrfToken);
    return result;
  },
  session: () => request<{ user: { id: string; username: string } }>("/api/admin/session"),
  logout: async () => {
    await request<void>("/api/admin/logout", { method: "POST" });
    sessionStorage.removeItem(csrfStorageKey);
  },
  keys: () => request<{ data: ApiKeySummary[] }>("/api/admin/keys"),
  models: () => request<{ data: GatewayModel[] }>("/api/admin/models"),
  providers: () => request<{ data: GatewayProviderStatus[] }>("/api/admin/providers"),
  providerConfigs: () => request<{ data: ManagedProvider[] }>("/api/admin/provider-configs"),
  upsertProvider: (providerId: string, input: ManagedProviderInput) =>
    request<{ provider: ManagedProvider }>(
      `/api/admin/provider-configs/${encodeURIComponent(providerId)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  hasAdminCsrf: () => Boolean(sessionStorage.getItem(csrfStorageKey)),
  requests: (keyId?: string) =>
    request<{ data: GatewayRequestLog[] }>(
      `/api/admin/requests?limit=100${keyId ? `&keyId=${encodeURIComponent(keyId)}` : ""}`,
    ),
  createKey: (input: CreateKeyInput) =>
    request<CreatedKey>("/api/admin/keys", { method: "POST", body: JSON.stringify(input) }),
  revokeKey: (keyId: string) =>
    request<{ revoked: boolean }>(`/api/admin/keys/${encodeURIComponent(keyId)}/revoke`, {
      method: "POST",
    }),
  updateKey: (keyId: string, input: Partial<CreateKeyInput>) =>
    request<{ updated: boolean }>(`/api/admin/keys/${encodeURIComponent(keyId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  codex: () => request<CodexStatus>("/api/admin/codex"),
  startCodexLogin: () => request<DeviceLogin>("/api/admin/codex/login", { method: "POST" }),
  cancelCodexLogin: (loginId: string) =>
    request<unknown>("/api/admin/codex/login/cancel", {
      method: "POST",
      body: JSON.stringify({ loginId }),
    }),
  logoutCodex: () => request<unknown>("/api/admin/codex/logout", { method: "POST" }),
  health: () => request<{ status: string }>("/healthz"),
  ready: () => request<{ status: string }>("/readyz"),
  systemUpdate: () => request<SystemUpdateInfo>("/api/admin/system/update"),
  startSystemUpdate: () =>
    request<{ requested: { id: string; requestedAt: string } }>("/api/admin/system/update", {
      method: "POST",
    }),
  testResponse: async (input: {
    key: string;
    model: string;
    instructions?: string;
    input: string;
  }) => {
    const response = await fetch("/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: input.input,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        stream: false,
        store: false,
      }),
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
      throw new ApiError(
        response.status,
        error && typeof error.message === "string" ? error.message : "Request failed",
        error && typeof error.code === "string" ? error.code : undefined,
      );
    }
    return body as GatewayResponse;
  },
};

export interface ApiKeySummary {
  id: string;
  mode: "live" | "test";
  name: string;
  prefix: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  allowedModels: string[];
  allowClientTools: boolean;
  rpmLimit: number;
  dailyRequestLimit: number;
  maxConcurrency: number;
  ipAllowlist: string[];
  requestBudget: number | null;
  tokenBudget: number | null;
  requestBalance: number | null;
  tokenBalance: number | null;
  activeRequests: number;
  usage: KeyUsage;
}

export interface CreateKeyInput {
  mode: "live" | "test";
  name: string;
  allowedModels: string[];
  allowClientTools: boolean;
  rpmLimit: number;
  dailyRequestLimit: number;
  maxConcurrency: number;
  ipAllowlist: string[];
  requestBudget: number | null;
  tokenBudget: number | null;
}

export interface CreatedKey extends ApiKeySummary {
  key: string;
}

export interface CodexStatus {
  account: {
    connected: boolean;
    authMode: string | null;
    planType: string | null;
    emailMasked: string | null;
    observedAt: number;
  };
  rateLimits: {
    available: boolean;
    primary: RateWindow | null;
    secondary: RateWindow | null;
    observedAt: number;
    byLimitId: Record<string, RateLimitBucket | null>;
    resetCredits: { availableCount: number | null } | null;
  };
  usage: {
    available: boolean;
    summary: {
      lifetimeTokens: number | null;
      peakDailyTokens: number | null;
      longestRunningTurnSec: number | null;
      currentStreakDays: number | null;
      longestStreakDays: number | null;
    } | null;
    dailyUsageBuckets: Array<{ startDate: string; tokens: number }> | null;
    observedAt: number;
  };
}

export interface RateWindow {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitBucket {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  credits: number | null;
  rateLimitReachedType: string | null;
  primary: RateWindow | null;
  secondary: RateWindow | null;
}

export interface GatewayModel {
  id: string;
  displayName: string;
  providerId?: string;
  providerName?: string;
  upstreamModel?: string;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

export interface GatewayProviderStatus {
  id: string;
  name: string;
  protocol: string;
  enabled: boolean;
  ready: boolean;
  modelsCount: number;
  error: string | null;
}

export interface ManagedProvider {
  id: string;
  name: string;
  protocol: "anthropic" | "openai-responses" | "openai-chat";
  baseUrl: string;
  enabled: boolean;
  models: string[];
  apiKeyConfigured: boolean;
  status: string | null;
}

export interface ManagedProviderInput {
  name: string;
  protocol: ManagedProvider["protocol"];
  baseUrl: string;
  enabled: boolean;
  models: string[];
  apiKey?: string;
}

export interface KeyUsage {
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

export interface GatewayRequestLog {
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

export interface GatewayResponse {
  id: string;
  status: "completed" | "failed" | "incomplete";
  model: string;
  output_text: string;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  error: { message: string; code: string } | null;
}

export interface SystemUpdateInfo {
  currentVersion: string | null;
  latest: {
    source: "github";
    repository: string;
    tag: string;
    version: string;
    commitSha: string;
    fetchedAt: string;
  };
  status: {
    status: "idle" | "pending" | "running" | "success" | "failed";
    version: string | null;
    requestedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    message: string | null;
  };
}

export interface DeviceLogin {
  type: "chatgptDeviceCode";
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
