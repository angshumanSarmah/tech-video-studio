import { z } from 'zod';
import { JobStatusSchema } from './job.ts';
import { RunStatusSchema } from './run.ts';

/**
 * Rows of the `events` table: an append-only progress log. The worker (and the server, for
 * transitions it makes) appends them; the server relays them over SSE. Each event belongs to a
 * run, a job or both.
 */
export const EVENT_TYPES = ['run_status', 'job_status', 'progress', 'log'] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const RunStatusPayloadSchema = z.strictObject({ status: RunStatusSchema });

export const JobStatusPayloadSchema = z.strictObject({
  status: JobStatusSchema,
  error: z.string().optional(),
});

export const PROGRESS_DONE_PCT = 100;

export const ProgressPayloadSchema = z.strictObject({
  pct: z.number().min(0).max(PROGRESS_DONE_PCT),
  message: z.string().optional(),
});

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogPayloadSchema = z.strictObject({ level: LogLevelSchema, message: z.string() });

export const RunStatusEventSchema = z.strictObject({
  type: z.literal('run_status'),
  payload: RunStatusPayloadSchema,
});
export const JobStatusEventSchema = z.strictObject({
  type: z.literal('job_status'),
  payload: JobStatusPayloadSchema,
});
export const ProgressEventSchema = z.strictObject({
  type: z.literal('progress'),
  payload: ProgressPayloadSchema,
});
export const LogEventSchema = z.strictObject({ type: z.literal('log'), payload: LogPayloadSchema });

/** Event `type` and its `payload`, discriminated by `type`. Validated on every write. */
export const EventBodySchema = z.discriminatedUnion('type', [
  RunStatusEventSchema,
  JobStatusEventSchema,
  ProgressEventSchema,
  LogEventSchema,
]);
export type EventBody = z.infer<typeof EventBodySchema>;

/** Payload shape for one event type. */
export type EventPayload<T extends EventType = EventType> = Extract<
  EventBody,
  { type: T }
>['payload'];
