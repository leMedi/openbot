PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`x_display_number` integer,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar_file_id` text,
	`avatar_shape` text DEFAULT 'squircle' NOT NULL,
	`avatar_color` text DEFAULT '#5865c4' NOT NULL,
	`default_mode` text DEFAULT 'default' NOT NULL,
	`default_model` text,
	`approval_mode` text DEFAULT 'allowlist' NOT NULL,
	`notify_on_updates` integer DEFAULT true NOT NULL,
	`hidden_from_sidebar` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`avatar_file_id`) REFERENCES `managed_files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agents_x_display_number_check" CHECK("__new_agents"."x_display_number" IS NULL OR "__new_agents"."x_display_number" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "x_display_number", "name", "description", "avatar_file_id", "avatar_shape", "avatar_color", "default_mode", "default_model", "approval_mode", "notify_on_updates", "hidden_from_sidebar", "created_at", "updated_at") SELECT "id", NULL, "name", "description", "avatar_file_id", "avatar_shape", "avatar_color", "default_mode", "default_model", "approval_mode", "notify_on_updates", "hidden_from_sidebar", "created_at", "updated_at" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_x_display_number_unique` ON `agents` (`x_display_number`);
