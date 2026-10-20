ALTER TABLE `tasks` ADD `kind` text DEFAULT 'work' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `creation_phase` text;