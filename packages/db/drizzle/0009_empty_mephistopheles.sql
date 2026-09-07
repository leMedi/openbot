CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`name` text NOT NULL,
	`instruction` text NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routines_revision_check" CHECK("routines"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `routines_agent_idx` ON `routines` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `routines_due_idx` ON `routines` (`enabled`,`next_run_at`);--> statement-breakpoint
ALTER TABLE `turns` ADD `routine_id` text REFERENCES routines(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `turns_routine_idx` ON `turns` (`routine_id`,`created_at`);
