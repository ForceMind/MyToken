CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`csrf_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent_hash` text,
	`ip_fingerprint` text,
	CONSTRAINT `fk_admin_sessions_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`password_changed_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`secret_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`last_used_at` integer,
	`allowed_models_json` text NOT NULL,
	`allow_client_tools` integer NOT NULL,
	`rpm_limit` integer NOT NULL,
	`daily_request_limit` integer NOT NULL,
	`max_concurrency` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`target_type` text,
	`target_id` text,
	`metadata_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bootstrap_state` (
	`singleton_id` integer PRIMARY KEY,
	`token_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `pending_tool_calls` (
	`call_id` text PRIMARY KEY,
	`response_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`worker_generation` integer NOT NULL,
	`rpc_request_id` text NOT NULL,
	`codex_thread_id` text NOT NULL,
	`codex_turn_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_digest` text NOT NULL,
	`result_digest` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	CONSTRAINT `fk_pending_tool_calls_api_key_id_api_keys_id_fk` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`id` text PRIMARY KEY,
	`api_key_id` text NOT NULL,
	`codex_thread_id` text NOT NULL,
	`codex_turn_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`store` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`expires_at` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`error_code` text,
	`metadata_json` text NOT NULL,
	CONSTRAINT `fk_responses_api_key_id_api_keys_id_fk` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_digest_unique` ON `admin_sessions` (`token_digest`);--> statement-breakpoint
CREATE INDEX `admin_sessions_user_id_index` ON `admin_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_at_index` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique` ON `admin_users` (`username`);--> statement-breakpoint
CREATE INDEX `api_keys_status_index` ON `api_keys` (`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `audit_events_created_at_index` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `pending_tool_calls_owner_index` ON `pending_tool_calls` (`api_key_id`,`response_id`);--> statement-breakpoint
CREATE INDEX `pending_tool_calls_expiry_index` ON `pending_tool_calls` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `responses_api_key_index` ON `responses` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `responses_expires_at_index` ON `responses` (`expires_at`);