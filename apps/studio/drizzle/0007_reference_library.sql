CREATE TABLE `__new_reference_videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`origin` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`topic_class` text,
	`devices` text DEFAULT '[]' NOT NULL,
	`breakdown_path` text NOT NULL,
	`record_path` text,
	`seed_hash` text,
	`attachments` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_reference_videos`("id", "slug", "title", "origin", "status", "topic_class", "devices", "breakdown_path", "record_path", "created_at", "updated_at") SELECT "id", 'reference-' || "id", "title", 'pasted', CASE WHEN "record_path" IS NULL THEN 'pending' ELSE 'ready' END, "topic_class", "devices", "breakdown_path", "record_path", "created_at", "created_at" FROM `reference_videos`;--> statement-breakpoint
DROP TABLE `reference_videos`;--> statement-breakpoint
ALTER TABLE `__new_reference_videos` RENAME TO `reference_videos`;--> statement-breakpoint
CREATE UNIQUE INDEX `reference_videos_slug_uq` ON `reference_videos` (`slug`);
