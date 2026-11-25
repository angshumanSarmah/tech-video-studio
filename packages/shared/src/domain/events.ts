import { z } from 'zod';
import { JobStatusSchema } from './job.ts';
import { PipelineStepIdSchema } from './pipeline.ts';
import { DecidedBySchema, GateIdSchema, GateStatusSchema, RunStatusSchema } from './run.ts';

/**
 * Rows of the `events` table: an append-only progress log. The worker (and the server, for
 * transitions it makes) appends them; the server relays them over SSE. Each event belongs to a
 * run, a job or both.
 */
export const EVENT_TYPES = ['run_status', 'job_status', 'progress', 'log', 'gate'] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/** A run's status, and the pipeline step it entered (the orchestrator writes one per step). */
export const RunStatusPayloadSchema = z.strictObject({
  status: RunStatusSchema,
  step: PipelineStepIdSchema.optional(),
});

/** A review gate opened (pending, with what blocks auto-approval) or decided. */
export const GatePayloadSchema = z.strictObject({
  gate: GateIdSchema,
  status: GateStatusSchema,
  decidedBy: DecidedBySchema.optional(),
  /** Why it cannot be auto-approved (empty: nothing blocks). */
  blocking: z.array(z.string()),
});

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
export const GateEventSchema = z.strictObject({
  type: z.literal('gate'),
  payload: GatePayloadSchema,
});

/** Event `type` and its `payload`, discriminated by `type`. Validated on every write. */
export const EventBodySchema = z.discriminatedUnion('type', [
  RunStatusEventSchema,
  JobStatusEventSchema,
  ProgressEventSchema,
  LogEventSchema,
  GateEventSchema,
]);
export type EventBody = z.infer<typeof EventBodySchema>;

/** Payload shape for one event type. */
export type EventPayload<T extends EventType = EventType> = Extract<
  EventBody,
  { type: T }
>['payload'];
