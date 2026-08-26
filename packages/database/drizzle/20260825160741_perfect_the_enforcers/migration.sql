ALTER TABLE `request_logs` ADD `provider_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `upstream_model` text;--> statement-breakpoint
CREATE INDEX `request_logs_provider_started_index` ON `request_logs` (`provider_id`,`started_at`);