CREATE TABLE `asset_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` text NOT NULL,
	`run_id` integer,
	`topic_id` integer,
	`beat_ids` text DEFAULT '[]' NOT NULL,
	`description` text NOT NULL,
	`family` text NOT NULL,
	`closest` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_requests_asset_run_uq` ON `asset_requests` (`asset_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `asset_requests_run_idx` ON `asset_requests` (`run_id`);