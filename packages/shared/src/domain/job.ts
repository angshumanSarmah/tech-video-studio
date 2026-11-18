import { z } from 'zod';

/** Lifecycle of a row in the `jobs` table (claimed and run by the worker). */
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/**
 * Kinds of event in the `run_events` table. The worker appends them; the server relays them over
 * SSE. Payload shapes per type are refined when the progress emitter lands (P0.5).
 */
export const RUN_EVENT_TYPES = ['status', 'progress', 'log'] as const;
export const RunEventTypeSchema = z.enum(RUN_EVENT_TYPES);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventPayloadSchema = z.record(z.string(), z.unknown());
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
