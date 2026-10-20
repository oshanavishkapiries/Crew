ALTER TABLE `phase_outputs` ADD `task_id` text REFERENCES tasks(id);--> statement-breakpoint
CREATE UNIQUE INDEX `phase_outputs_task_id_unique` ON `phase_outputs` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_phase_task` ON `tasks` (`board_id`,`creation_phase`) WHERE "tasks"."kind" = 'phase' AND "tasks"."status" NOT IN ('merged', 'cancelled');