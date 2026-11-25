ALTER TABLE `gates` ADD `carried_from` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `step_requests` text DEFAULT '{}' NOT NULL;