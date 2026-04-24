CREATE TABLE `approved_deductions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`location_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`days` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approved_deductions_request_id_unique` ON `approved_deductions` (`request_id`);--> statement-breakpoint
CREATE TABLE `hcm_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`hcm_mutation_id` text,
	`synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hcm_outbox_request_id_unique` ON `hcm_outbox` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hcm_outbox_idempotency_key_unique` ON `hcm_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `hcm_outbox_status_next_attempt_idx` ON `hcm_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `requests` ADD `hcm_sync_status` text DEFAULT 'not_required' NOT NULL;