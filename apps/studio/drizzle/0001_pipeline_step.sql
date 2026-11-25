ALTER TABLE `runs` ADD `pipeline_step` text DEFAULT 'ingest' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `step_job_id` integer REFERENCES jobs(id) ON DELETE set null;