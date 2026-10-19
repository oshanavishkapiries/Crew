CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`role_id` text NOT NULL,
	`name` text NOT NULL,
	`personality` text DEFAULT '' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`cli_type` text NOT NULL,
	`mode` text DEFAULT 'spawn' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_heartbeat_at` integer,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`current_phase` text DEFAULT 'grill' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`layer` text NOT NULL,
	`role_id` text,
	`task_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source` text,
	`promoted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `merge_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`conflict_task_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conflict_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`from_agent_id` text,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `phase_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`phase` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_prompt` text NOT NULL,
	`permission_profile` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`adapter` text NOT NULL,
	`pid` integer,
	`session_id` text,
	`resumed_from_run_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`exit_code` integer,
	`log_path` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`blocked_by_task_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `blocked_by_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_by_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`acceptance_criteria` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`assignee_agent_id` text,
	`role_id` text,
	`created_by` text DEFAULT 'human' NOT NULL,
	`parent_task_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`branch` text,
	`worktree_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verification_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step` text NOT NULL,
	`passed` integer NOT NULL,
	`output` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`config` text,
	`created_at` integer NOT NULL
);
