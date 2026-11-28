PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`description` text,
	`style_version` integer DEFAULT 1 NOT NULL,
	`licence` text NOT NULL,
	`source` text NOT NULL,
	`svg_path` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`variants` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	`error` text,
	`approved_variant` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "assets_approved_svg_ck" CHECK("status" <> 'approved' or "svg_path" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_assets`("id", "name", "family", "tags", "aliases", "description", "style_version", "licence", "source", "svg_path", "status", "created_at", "updated_at") SELECT "id", "name", "family", "tags", "aliases", "description", "style_version", "licence", "source", "svg_path", "status", "created_at", "updated_at" FROM `assets`;--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assets_family_idx` ON `assets` (`family`);--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);