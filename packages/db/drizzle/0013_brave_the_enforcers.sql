UPDATE `routines`
SET `conversation_id` = (
  SELECT `main`.`id`
  FROM `conversations` AS `direct`
  JOIN `conversations` AS `main`
    ON `main`.`owner_agent_id` = `direct`.`owner_agent_id`
   AND `main`.`origin` = 'agent-main'
  WHERE `direct`.`id` = `routines`.`conversation_id`
)
WHERE EXISTS (
  SELECT 1
  FROM `conversations` AS `direct`
  WHERE `direct`.`id` = `routines`.`conversation_id`
    AND `direct`.`origin` = 'agent-direct'
);--> statement-breakpoint
DELETE FROM `conversations` WHERE `origin` = 'agent-direct';--> statement-breakpoint
DROP INDEX `conversations_agent_direct_unique`;
