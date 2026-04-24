CREATE TABLE `balances` (
	`employee_id` text NOT NULL,
	`location_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`hcm_balance` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`employee_id`, `location_id`, `leave_type`)
);
--> statement-breakpoint
CREATE TABLE `holds` (
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
CREATE UNIQUE INDEX `holds_request_id_unique` ON `holds` (`request_id`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`location_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`days` integer NOT NULL,
	`status` text NOT NULL,
	`client_request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_client_request_id_unique` ON `requests` (`client_request_id`);