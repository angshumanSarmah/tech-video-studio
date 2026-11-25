ALTER TABLE `memory_rules` ADD `note` text;--> statement-breakpoint
ALTER TABLE `memory_rules` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `memory_rules` ADD `source_event_id` integer REFERENCES events(id) ON DELETE set null;