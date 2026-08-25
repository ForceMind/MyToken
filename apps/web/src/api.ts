const csrfStorageKey = "mytoken.csrf";

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
    throw new ApiError(
      response.status,
      error && typeof error.message === "string" ? error.message : "Request failed",
      error && typeof error.code === "string" ? error.code : undefined,
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
  createKey: (input: CreateKeyInput) =>
    request<CreatedKey>("/api/admin/keys", { method: "POST", body: JSON.stringify(input) }),
  revokeKey: (keyId: string) =>
    request<{ revoked: boolean }>(`/api/admin/keys/${encodeURIComponent(keyId)}/revoke`, {
      method: "POST",
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
}

export interface CreateKeyInput {
  mode: "live" | "test";
  name: string;
  allowedModels: string[];
  allowClientTools: boolean;
  rpmLimit: number;
  dailyRequestLimit: number;
  maxConcurrency: number;
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
  };
}

interface RateWindow {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
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
