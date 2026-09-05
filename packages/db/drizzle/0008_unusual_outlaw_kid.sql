CREATE TABLE `profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`about` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "profile_singleton_check" CHECK("profile"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `profile` (`id`, `first_name`, `last_name`, `about`, `timezone`, `created_at`, `updated_at`)
VALUES (1, '', '', '', '', unixepoch() * 1000, unixepoch() * 1000);
