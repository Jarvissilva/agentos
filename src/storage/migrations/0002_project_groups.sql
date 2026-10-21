DROP INDEX `projects_cwd_unique`;
--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `cwd`;
--> statement-breakpoint
ALTER TABLE `automations` ADD COLUMN `project_id` text REFERENCES `projects`(`id`) ON DELETE set null;
