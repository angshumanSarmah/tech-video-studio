import { z } from 'zod';

/** Lifecycle of a row in the `jobs` table (claimed and run by the worker). */
/** `cancelled`: its run was cancelled while it waited or ran (never retried). */
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;
