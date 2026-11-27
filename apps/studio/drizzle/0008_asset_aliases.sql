CREATE TABLE `seed_state` (
	`key` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `aliases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `description` text;