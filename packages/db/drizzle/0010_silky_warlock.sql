UPDATE `conversations` AS `candidate`
SET `origin` = 'agent-main'
WHERE `candidate`.`owner_agent_id` IS NOT NULL
  AND (`candidate`.`origin` IS NULL OR `candidate`.`origin` <> 'agent-direct')
  AND NOT EXISTS (
    SELECT 1 FROM `conversations` AS `existing`
    WHERE `existing`.`owner_agent_id` = `candidate`.`owner_agent_id`
      AND `existing`.`origin` = 'agent-main'
  )
  AND `candidate`.`id` = (
    SELECT `first`.`id` FROM `conversations` AS `first`
    WHERE `first`.`owner_agent_id` = `candidate`.`owner_agent_id`
      AND (`first`.`origin` IS NULL OR `first`.`origin` <> 'agent-direct')
    ORDER BY `first`.`created_at`, `first`.`id`
    LIMIT 1
  );
--> statement-breakpoint
INSERT INTO `conversations` (
  `id`, `owner_agent_id`, `title`, `origin`, `created_at`, `updated_at`
)
SELECT
  'cnv_' || substr(`agent`.`id`, 5),
  `agent`.`id`,
  `agent`.`name`,
  'agent-main',
  `agent`.`created_at`,
  `agent`.`updated_at`
FROM `agents` AS `agent`
WHERE NOT EXISTS (
  SELECT 1 FROM `conversations` AS `main`
  WHERE `main`.`owner_agent_id` = `agent`.`id`
    AND `main`.`origin` = 'agent-main'
);
--> statement-breakpoint
UPDATE `routines`
SET `conversation_id` = (
  SELECT `main`.`id`
  FROM `conversations` AS `old`
  JOIN `conversations` AS `main`
    ON `main`.`owner_agent_id` = `old`.`owner_agent_id`
   AND `main`.`origin` = 'agent-main'
  WHERE `old`.`id` = `routines`.`conversation_id`
)
WHERE EXISTS (
  SELECT 1 FROM `conversations` AS `old`
  WHERE `old`.`id` = `routines`.`conversation_id`
    AND `old`.`owner_agent_id` IS NOT NULL
    AND (`old`.`origin` IS NULL OR `old`.`origin` NOT IN ('agent-direct', 'agent-main'))
);
--> statement-breakpoint
INSERT INTO `groups` (`id`, `name`, `description`, `members_json`, `created_at`, `updated_at`)
SELECT
  'grp_' || substr(`conversation`.`id`, 5),
  COALESCE(`conversation`.`title`, `agent`.`name` || ' chat'),
  '',
  json_object(
    'version', 1,
    'members', json_array(json_object(
      'type', 'agent',
      'agentId', `conversation`.`owner_agent_id`
    ))
  ),
  `conversation`.`created_at`,
  `conversation`.`updated_at`
FROM `conversations` AS `conversation`
JOIN `agents` AS `agent` ON `agent`.`id` = `conversation`.`owner_agent_id`
WHERE `conversation`.`owner_agent_id` IS NOT NULL
  AND (`conversation`.`origin` IS NULL OR `conversation`.`origin` NOT IN ('agent-direct', 'agent-main'));
--> statement-breakpoint
UPDATE `conversations`
SET
  `owner_group_id` = 'grp_' || substr(`id`, 5),
  `owner_agent_id` = NULL
WHERE `owner_agent_id` IS NOT NULL
  AND (`origin` IS NULL OR `origin` NOT IN ('agent-direct', 'agent-main'));
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_agent_main_unique` ON `conversations` (`owner_agent_id`) WHERE "conversations"."owner_agent_id" IS NOT NULL AND "conversations"."origin" = 'agent-main';
