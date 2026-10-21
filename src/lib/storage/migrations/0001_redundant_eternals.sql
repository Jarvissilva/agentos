CREATE TABLE `automation_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`definition` text NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`cwd` text NOT NULL,
	`file` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automations_name_unique` ON `automations` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `automations_slug_unique` ON `automations` (`slug`);--> statement-breakpoint
CREATE TABLE `directory_locks` (
	`path` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcp_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`mcp_id` text NOT NULL,
	`provider` text NOT NULL,
	`path` text NOT NULL,
	`entry` text NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`mcp_id`) REFERENCES `mcps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcps_name_unique` ON `mcps` (`name`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`run_id` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`metadata` text NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`step` integer,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`cwd` text NOT NULL,
	`status` text NOT NULL,
	`occurrence` text,
	`definition` text NOT NULL,
	`owner_pid` integer,
	`owner_identity` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_occurrence_unique` ON `runs` (`occurrence`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`automation_id` text PRIMARY KEY NOT NULL,
	`definition` text NOT NULL,
	`next_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `skill_links` (
	`path` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`provider` text NOT NULL,
	`target` text NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`directory` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_name_unique` ON `skills` (`name`);--> statement-breakpoint
CREATE TABLE `step_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`native_id` text,
	`result` text,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
