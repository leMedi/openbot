CREATE TABLE `agent_mcp_accounts` (
	`agent_id` text NOT NULL,
	`account_id` text NOT NULL,
	`enabled_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `account_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `mcp_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_mcp_accounts_account_idx` ON `agent_mcp_accounts` (`account_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`avatar_file_id` text,
	`default_mode` text DEFAULT 'default' NOT NULL,
	`default_model` text,
	`approval_mode` text DEFAULT 'allowlist' NOT NULL,
	`notify_on_updates` integer DEFAULT true NOT NULL,
	`hidden_from_sidebar` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`avatar_file_id`) REFERENCES `managed_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `conversation_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`parent_checkpoint_id` text,
	`schema_version` integer NOT NULL,
	`state_json` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`,`parent_checkpoint_id`) REFERENCES `conversation_checkpoints`(`conversation_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "checkpoints_schema_version_check" CHECK("conversation_checkpoints"."schema_version" > 0),
	CONSTRAINT "checkpoints_state_json_check" CHECK(json_valid("conversation_checkpoints"."state_json")),
	CONSTRAINT "checkpoints_byte_size_check" CHECK("conversation_checkpoints"."byte_size" >= 0),
	CONSTRAINT "checkpoints_hash_check" CHECK(length("conversation_checkpoints"."content_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoints_conversation_id_unique` ON `conversation_checkpoints` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `checkpoints_conversation_created_idx` ON `conversation_checkpoints` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text,
	`sequence_no` integer NOT NULL,
	`kind` text NOT NULL,
	`role` text,
	`direction` text NOT NULL,
	`sender_agent_id` text,
	`recipient_agent_id` text,
	`delivery_id` text,
	`body_text` text,
	`payload_json` text DEFAULT '{"version":1}' NOT NULL,
	`reply_to_entry_id` text,
	`thread_root_entry_id` text,
	`branch_parent_entry_id` text,
	`reactions_json` text DEFAULT '{"version":1,"items":[]}' NOT NULL,
	`attachments_json` text DEFAULT '{"version":1,"items":[]}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipient_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`,`turn_id`) REFERENCES `turns`(`conversation_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`,`reply_to_entry_id`) REFERENCES `conversation_messages`(`conversation_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`,`thread_root_entry_id`) REFERENCES `conversation_messages`(`conversation_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`,`branch_parent_entry_id`) REFERENCES `conversation_messages`(`conversation_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "messages_sequence_check" CHECK("conversation_messages"."sequence_no" > 0),
	CONSTRAINT "messages_kind_check" CHECK("conversation_messages"."kind" IN ('message', 'tool_call', 'tool_result', 'status', 'system', 'other')),
	CONSTRAINT "messages_role_check" CHECK("conversation_messages"."role" IS NULL OR "conversation_messages"."role" IN ('user', 'assistant', 'system', 'tool')),
	CONSTRAINT "messages_direction_check" CHECK("conversation_messages"."direction" IN ('inbound', 'outbound', 'internal')),
	CONSTRAINT "messages_payload_json_check" CHECK(json_valid("conversation_messages"."payload_json")),
	CONSTRAINT "messages_reactions_json_check" CHECK(json_valid("conversation_messages"."reactions_json")),
	CONSTRAINT "messages_attachments_json_check" CHECK(json_valid("conversation_messages"."attachments_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_sequence_unique` ON `conversation_messages` (`conversation_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_id_unique` ON `conversation_messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_turn_idx` ON `conversation_messages` (`turn_id`,`sequence_no`);--> statement-breakpoint
CREATE INDEX `messages_delivery_idx` ON `conversation_messages` (`delivery_id`);--> statement-breakpoint
CREATE INDEX `messages_reply_idx` ON `conversation_messages` (`reply_to_entry_id`);--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `conversation_messages` (`thread_root_entry_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_agent_id` text,
	`owner_group_id` text,
	`title` text,
	`current_checkpoint_id` text,
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
	FOREIGN KEY (`current_checkpoint_id`) REFERENCES `conversation_checkpoints`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "conversations_owner_check" CHECK(("conversations"."owner_agent_id" IS NOT NULL) <> ("conversations"."owner_group_id" IS NOT NULL)),
	CONSTRAINT "conversations_sequence_check" CHECK("conversations"."next_sequence_no" > 0 AND "conversations"."last_read_sequence_no" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_group_owner_unique` ON `conversations` (`owner_group_id`) WHERE "conversations"."owner_group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `conversations_agent_owner_idx` ON `conversations` (`owner_agent_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar_file_id` text,
	`members_json` text DEFAULT '{"version":1,"members":[]}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`avatar_file_id`) REFERENCES `managed_files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "groups_members_json_check" CHECK(json_valid("groups"."members_json"))
);
--> statement-breakpoint
CREATE TABLE `managed_files` (
	`id` text PRIMARY KEY NOT NULL,
	`relative_path` text NOT NULL,
	`original_name` text NOT NULL,
	`media_type` text,
	`byte_size` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "managed_files_byte_size_check" CHECK("managed_files"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_files_relative_path_unique` ON `managed_files` (`relative_path`);--> statement-breakpoint
CREATE TABLE `mcp_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`label` text NOT NULL,
	`auth_type` text NOT NULL,
	`credentials_json` text NOT NULL,
	`token_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mcp_accounts_auth_type_check" CHECK("mcp_accounts"."auth_type" IN ('api_key', 'oauth')),
	CONSTRAINT "mcp_accounts_credentials_json_check" CHECK(json_valid("mcp_accounts"."credentials_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_accounts_server_label_unique` ON `mcp_accounts` (`server_id`,`label`);--> statement-breakpoint
CREATE INDEX `mcp_accounts_server_idx` ON `mcp_accounts` (`server_id`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`server_key` text NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`configuration_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mcp_servers_configuration_json_check" CHECK(json_valid("mcp_servers"."configuration_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_server_key_unique` ON `mcp_servers` (`server_key`);--> statement-breakpoint
CREATE TABLE `memory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`subject_agent_id` text,
	`authored_by_agent_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`metadata_json` text DEFAULT '{"version":1}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authored_by_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "memory_scope_check" CHECK("memory_items"."scope" IN ('user', 'agent')),
	CONSTRAINT "memory_kind_check" CHECK("memory_items"."kind" IN ('profile', 'log', 'note')),
	CONSTRAINT "memory_subject_check" CHECK(("memory_items"."scope" = 'user' AND "memory_items"."subject_agent_id" IS NULL)
      OR ("memory_items"."scope" = 'agent' AND "memory_items"."subject_agent_id" IS NOT NULL)),
	CONSTRAINT "memory_metadata_json_check" CHECK(json_valid("memory_items"."metadata_json"))
);
--> statement-breakpoint
CREATE INDEX `memory_scope_idx` ON `memory_items` (`scope`,`subject_agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`target_agent_id` text,
	`target_group_id` text,
	`parent_turn_id` text,
	`lane` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`mode` text DEFAULT 'default' NOT NULL,
	`model_provider` text,
	`model_id` text,
	`request_id` text,
	`idempotency_key` text,
	`effective_tools_json` text DEFAULT '{"version":1,"tools":[]}' NOT NULL,
	`effective_permissions_json` text DEFAULT '{"version":1}' NOT NULL,
	`runtime_context_json` text DEFAULT '{"version":1}' NOT NULL,
	`waiting_state_json` text,
	`error_json` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`orchestration_round` integer,
	`position_in_round` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "turns_target_check" CHECK(("turns"."target_agent_id" IS NOT NULL) <> ("turns"."target_group_id" IS NOT NULL)),
	CONSTRAINT "turns_lane_check" CHECK("turns"."lane" IN ('user', 'agent', 'background')),
	CONSTRAINT "turns_status_check" CHECK("turns"."status" IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "turns_attempt_count_check" CHECK("turns"."attempt_count" >= 0),
	CONSTRAINT "turns_orchestration_check" CHECK(("turns"."orchestration_round" IS NULL OR "turns"."orchestration_round" >= 0)
      AND ("turns"."position_in_round" IS NULL OR "turns"."position_in_round" >= 0)),
	CONSTRAINT "turns_tools_json_check" CHECK(json_valid("turns"."effective_tools_json")),
	CONSTRAINT "turns_permissions_json_check" CHECK(json_valid("turns"."effective_permissions_json")),
	CONSTRAINT "turns_runtime_json_check" CHECK(json_valid("turns"."runtime_context_json")),
	CONSTRAINT "turns_waiting_json_check" CHECK("turns"."waiting_state_json" IS NULL OR json_valid("turns"."waiting_state_json")),
	CONSTRAINT "turns_error_json_check" CHECK("turns"."error_json" IS NULL OR json_valid("turns"."error_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_request_id_unique` ON `turns` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_idempotency_key_unique` ON `turns` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `turns_conversation_id_unique` ON `turns` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `turns_queue_idx` ON `turns` (`status`,`lane`,`created_at`);--> statement-breakpoint
CREATE INDEX `turns_conversation_idx` ON `turns` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `turns_parent_idx` ON `turns` (`parent_turn_id`);