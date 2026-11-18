import { z } from 'zod';

/** Lifecycle of a row in the `jobs` table (claimed and run by the worker). */
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;
