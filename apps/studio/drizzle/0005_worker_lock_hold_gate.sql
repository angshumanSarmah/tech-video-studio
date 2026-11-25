CREATE TABLE `worker_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`host` text NOT NULL,
	`pid` integer NOT NULL,
	`kind` text NOT NULL,
	`llm_mode` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	CONSTRAINT "worker_lock_single_ck" CHECK("worker_lock"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `hold_gate` text;