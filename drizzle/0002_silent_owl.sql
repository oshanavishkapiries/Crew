ALTER TABLE `runs` ADD `kind` text DEFAULT 'work' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reviewer_agent_id` text REFERENCES agents(id);