UPDATE `conversations` SET `current_checkpoint_id` = NULL;--> statement-breakpoint
DROP TABLE `conversation_checkpoints`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_agent_id` text,
	`owner_group_id` text,
	`title` text,
	`current_plan_uri` text,
	`next_sequence_no` integer DEFAULT 1 NOT NULL,
	`last_read_sequence_no` integer DEFAULT 0 NOT NULL,
	`manually_unread` integer DEFAULT false NOT NULL,
	`introduction_pending` integer DEFAULT false NOT NULL,
	`origin` text,
	`purpose` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "conversations_owner_check" CHECK(("owner_agent_id" IS NOT NULL) <> ("owner_group_id" IS NOT NULL)),
	CONSTRAINT "conversations_sequence_check" CHECK("next_sequence_no" > 0 AND "last_read_sequence_no" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "owner_agent_id", "owner_group_id", "title", "current_plan_uri", "next_sequence_no", "last_read_sequence_no", "manually_unread", "introduction_pending", "origin", "purpose", "created_at", "updated_at") SELECT "id", "owner_agent_id", "owner_group_id", "title", "current_plan_uri", "next_sequence_no", "last_read_sequence_no", "manually_unread", "introduction_pending", "origin", "purpose", "created_at", "updated_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_group_owner_unique` ON `conversations` (`owner_group_id`) WHERE "conversations"."owner_group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `conversations_agent_owner_idx` ON `conversations` (`owner_agent_id`,`updated_at`);
