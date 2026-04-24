CREATE TABLE `inconsistencies` (
	`employee_id` text NOT NULL,
	`location_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`detected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`employee_id`, `location_id`, `leave_type`)
);
