CREATE TABLE `request_logs` (
	`id` text PRIMARY KEY,
	`request_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`model` text,
	`billable` integer NOT NULL,
	`status_code` integer,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`error_code` text,
	`source_ip` text NOT NULL,
	`user_agent` text,
	`request_body_json` text NOT NULL,
	`response_body_json` text,
	CONSTRAINT `fk_request_logs_api_key_id_api_keys_id_fk` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `ip_allowlist_json` text NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `request_budget` integer;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `token_budget` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `request_logs_request_id_unique` ON `request_logs` (`request_id`);--> statement-breakpoint
CREATE INDEX `request_logs_api_key_started_index` ON `request_logs` (`api_key_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `request_logs_started_index` ON `request_logs` (`started_at`);