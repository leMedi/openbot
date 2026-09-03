CREATE TABLE `setting` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_agent_model` text DEFAULT 'hy3' NOT NULL,
	`orchestrator_model` text DEFAULT 'gpt-5.6-luna' NOT NULL,
	CONSTRAINT "setting_singleton_check" CHECK("setting"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `setting` (`id`, `default_agent_model`, `orchestrator_model`)
VALUES (1, 'hy3', 'gpt-5.6-luna');
