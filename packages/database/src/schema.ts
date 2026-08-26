import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    passwordChangedAt: integer("password_changed_at").notNull(),
    disabledAt: integer("disabled_at"),
  },
  (table) => [uniqueIndex("admin_users_username_unique").on(table.username)],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenDigest: text("token_digest").notNull(),
    csrfDigest: text("csrf_digest").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    userAgentHash: text("user_agent_hash"),
    ipFingerprint: text("ip_fingerprint"),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_digest_unique").on(table.tokenDigest),
    index("admin_sessions_user_id_index").on(table.userId),
    index("admin_sessions_expires_at_index").on(table.expiresAt),
  ],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretDigest: text("secret_digest").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    lastUsedAt: integer("last_used_at"),
    allowedModelsJson: text("allowed_models_json").notNull(),
    allowClientTools: integer("allow_client_tools").notNull(),
    rpmLimit: integer("rpm_limit").notNull(),
    dailyRequestLimit: integer("daily_request_limit").notNull(),
    maxConcurrency: integer("max_concurrency").notNull(),
    ipAllowlistJson: text("ip_allowlist_json").notNull(),
    requestBudget: integer("request_budget"),
    tokenBudget: integer("token_budget"),
  },
  (table) => [index("api_keys_status_index").on(table.revokedAt, table.expiresAt)],
);

export const responses = sqliteTable(
  "responses",
  {
    id: text("id").primaryKey(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    codexThreadId: text("codex_thread_id").notNull(),
    codexTurnId: text("codex_turn_id").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    store: integer("store").notNull(),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    expiresAt: integer("expires_at"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    errorCode: text("error_code"),
    metadataJson: text("metadata_json").notNull(),
  },
  (table) => [
    index("responses_api_key_index").on(table.apiKeyId),
    index("responses_expires_at_index").on(table.expiresAt),
  ],
);

export const pendingToolCalls = sqliteTable(
  "pending_tool_calls",
  {
    callId: text("call_id").primaryKey(),
    responseId: text("response_id").notNull(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    workerGeneration: integer("worker_generation").notNull(),
    rpcRequestId: text("rpc_request_id").notNull(),
    codexThreadId: text("codex_thread_id").notNull(),
    codexTurnId: text("codex_turn_id").notNull(),
    toolName: text("tool_name").notNull(),
    argumentsDigest: text("arguments_digest").notNull(),
    resultDigest: text("result_digest"),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    index("pending_tool_calls_owner_index").on(table.apiKeyId, table.responseId),
    index("pending_tool_calls_expiry_index").on(table.status, table.expiresAt),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    action: text("action").notNull(),
    result: text("result").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadataJson: text("metadata_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("audit_events_created_at_index").on(table.createdAt)],
);

export const bootstrapState = sqliteTable("bootstrap_state", {
  singletonId: integer("singleton_id").primaryKey(),
  tokenDigest: text("token_digest").notNull(),
  createdAt: integer("created_at").notNull(),
  consumedAt: integer("consumed_at"),
});

export const requestLogs = sqliteTable(
  "request_logs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    model: text("model"),
    providerId: text("provider_id").notNull(),
    upstreamModel: text("upstream_model"),
    billable: integer("billable").notNull(),
    statusCode: integer("status_code"),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    errorCode: text("error_code"),
    sourceIp: text("source_ip").notNull(),
    userAgent: text("user_agent"),
    requestBodyJson: text("request_body_json").notNull(),
    responseBodyJson: text("response_body_json"),
  },
  (table) => [
    uniqueIndex("request_logs_request_id_unique").on(table.requestId),
    index("request_logs_api_key_started_index").on(table.apiKeyId, table.startedAt),
    index("request_logs_started_index").on(table.startedAt),
    index("request_logs_provider_started_index").on(table.providerId, table.startedAt),
  ],
);
