ALTER TABLE `llm_calls` ADD `preamble_version` text;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `normalizer_fixes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `tokens_reasoning` integer DEFAULT 0 NOT NULL;