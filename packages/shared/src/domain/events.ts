import { z } from 'zod';
import { RegenerateOutcomeSchema } from '../curator/repair-outcome.ts';
import { FixFieldSchema } from '../curator/review.ts';
import { JobStatusSchema } from './job.ts';
import { PipelineStepIdSchema, RegenerateTargetSchema } from './pipeline.ts';
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

/** What a person did at a gate (P1C.10): the decision a style-rule proposal is made from. */
export const GATE_DECISION_ACTIONS = ['approve', 'reject', 'edit', 'regenerate'] as const;

export const GateDecisionRecordSchema = z.strictObject({
  action: z.enum(GATE_DECISION_ACTIONS),
  /** The person's text: approve / reject / edit notes, or a regenerate's feedback. */
  note: z.string().optional(),
  /** What the decision was made on: the gate's subject (a step or a spec version id). */
  subjectId: z.number().int().positive().optional(),
  /** An edit's saved step or version (absent when the edit changed nothing). */
  savedId: z.number().int().positive().optional(),
  /** A regenerate's target, beat, fields and source. */
  target: RegenerateTargetSchema.optional(),
  beatId: z.string().optional(),
  fields: z.array(FixFieldSchema).optional(),
  sourceId: z.number().int().positive().optional(),
});
export type GateDecisionRecord = z.infer<typeof GateDecisionRecordSchema>;

/**
 * A review gate opened (pending, with what blocks auto-approval) or decided. A person's decision
 * (approve, reject, edit, regenerate) writes one event carrying `decision`: an edit or
 * regenerate leaves the gate pending.
 */
export const GatePayloadSchema = z.strictObject({
  gate: GateIdSchema,
  status: GateStatusSchema,
  decidedBy: DecidedBySchema.optional(),
  /** Why it cannot be auto-approved (empty: nothing blocks). */
  blocking: z.array(z.string()),
  decision: GateDecisionRecordSchema.optional(),
  /**
   * The gate reopened after a person's beat regenerate: what each of its repair requests did
   * (changed, or unchanged and why), so a regenerate that changed nothing never looks like one
   * that did.
   */
  regenerated: RegenerateOutcomeSchema.optional(),
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
