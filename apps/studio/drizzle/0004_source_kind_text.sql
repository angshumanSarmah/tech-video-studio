PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`file_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`text_path` text,
	`content_hash` text,
	`title` text,
	`error` text,
	`error_code` text,
	`extracted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sources_kind_ck" CHECK(("__new_sources"."kind" = 'url' and "__new_sources"."url" is not null and "__new_sources"."file_path" is null) or ("__new_sources"."kind" in ('file', 'text') and "__new_sources"."file_path" is not null and "__new_sources"."url" is null))
);
--> statement-breakpoint
INSERT INTO `__new_sources`("id", "topic_id", "kind", "url", "file_path", "status", "text_path", "content_hash", "title", "error", "error_code", "extracted_at", "created_at") SELECT "id", "topic_id", "kind", "url", "file_path", "status", "text_path", "content_hash", "title", "error", "error_code", "extracted_at", "created_at" FROM `sources`;--> statement-breakpoint
DROP TABLE `sources`;--> statement-breakpoint
ALTER TABLE `__new_sources` RENAME TO `sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sources_topic_idx` ON `sources` (`topic_id`);