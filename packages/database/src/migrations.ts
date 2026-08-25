export interface Migration {
  id: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    id: "0001_initial",
    sql: `
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL,
  disabled_at INTEGER
);
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  csrf_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent_hash TEXT,
  ip_fingerprint TEXT
);
CREATE INDEX admin_sessions_user_id_index ON admin_sessions(user_id);
CREATE INDEX admin_sessions_expires_at_index ON admin_sessions(expires_at);
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('live', 'test')),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  secret_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  allowed_models_json TEXT NOT NULL,
  allow_client_tools INTEGER NOT NULL CHECK(allow_client_tools IN (0, 1)),
  rpm_limit INTEGER NOT NULL CHECK(rpm_limit > 0),
  daily_request_limit INTEGER NOT NULL CHECK(daily_request_limit > 0),
  max_concurrency INTEGER NOT NULL CHECK(max_concurrency > 0)
);
CREATE INDEX api_keys_status_index ON api_keys(revoked_at, expires_at);
CREATE TABLE responses (
  id TEXT PRIMARY KEY NOT NULL,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  codex_thread_id TEXT NOT NULL,
  codex_turn_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  store INTEGER NOT NULL CHECK(store IN (0, 1)),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  expires_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  error_code TEXT,
  metadata_json TEXT NOT NULL
);
CREATE INDEX responses_api_key_index ON responses(api_key_id);
CREATE INDEX responses_expires_at_index ON responses(expires_at);
CREATE TABLE pending_tool_calls (
  call_id TEXT PRIMARY KEY NOT NULL,
  response_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  worker_generation INTEGER NOT NULL,
  rpc_request_id TEXT NOT NULL,
  codex_thread_id TEXT NOT NULL,
  codex_turn_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_digest TEXT NOT NULL,
  result_digest TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX pending_tool_calls_owner_index ON pending_tool_calls(api_key_id, response_id);
CREATE INDEX pending_tool_calls_expiry_index ON pending_tool_calls(status, expires_at);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_events_created_at_index ON audit_events(created_at);
CREATE TABLE bootstrap_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK(singleton_id = 1),
  token_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
`,
  },
];
