import { z } from 'zod';
import { ModelRoleSchema } from '../config/llm.ts';
import { GateBadgeSchema } from '../curator/report.ts';
import { DirectorPlanSchema } from '../director/plan.ts';
import { PipelineStepIdSchema, RegenerateTargetSchema } from '../domain/pipeline.ts';
import { DecidedBySchema, GateIdSchema, GateStatusSchema, RunStatusSchema } from '../domain/run.ts';
import { ResearchNotesSchema } from '../research/notes.ts';
import { VideoSpecShapeSchema } from '../spec/shape.ts';
import { IdParamSchema } from './common.ts';

/** `/api/runs/:id/gates/:gate` (P1C.9). */
export const GateParamsSchema = z.object({ id: IdParamSchema, gate: GateIdSchema });

/**
 * What a gate reviews: a finished step's output (research notes, the beat sheet) or a spec
 * version (scenes, draft). Its `id` is the `subjectId` an approve or an edit names.
 */
export const GateSubjectDtoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('step'), id: z.number().int().positive() }),
  z.object({
    kind: z.literal('spec_version'),
    id: z.number().int().positive(),
    version: z.number().int().positive(),
  }),
]);
export type GateSubjectDto = z.infer<typeof GateSubjectDtoSchema>;

/** A check's finding: `{ path, code, message }`, the path a JSON path into the subject. */
export const GateIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type GateIssue = z.infer<typeof GateIssueSchema>;

/** The subject itself, by gate. */
export const GateContentSchema = z.discriminatedUnion('gate', [
  z.object({ gate: z.literal('research'), notes: ResearchNotesSchema }),
  z.object({ gate: z.literal('beat_sheet'), plan: DirectorPlanSchema }),
  z.object({ gate: z.literal('scenes'), spec: VideoSpecShapeSchema }),
  z.object({ gate: z.literal('draft'), spec: VideoSpecShapeSchema }),
]);
export type GateContent = z.infer<typeof GateContentSchema>;

/** What the run's LLM calls cost so far, in USD, in total and per role. */
export const RunCostDtoSchema = z.object({
  totalUsd: z.number().min(0),
  byRole: z.array(
    z.object({
      role: ModelRoleSchema,
      costUsd: z.number().min(0),
      calls: z.number().int().min(0),
    }),
  ),
});
export type RunCostDto = z.infer<typeof RunCostDtoSchema>;

/** `GET /api/runs/:id/gates/:gate`: everything a review of the gate needs. */
export const GateDtoSchema = z.object({
  runId: z.number().int(),
  gate: GateIdSchema,
  /** The gate's row; null until the run first reaches it. */
  status: GateStatusSchema.nullable(),
  decidedBy: DecidedBySchema.nullable(),
  notes: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** The run is stopped at this gate for a decision (approve, edit, regenerate, reject). */
  waiting: z.boolean(),
  /** Null when there is nothing to review yet (the run has not got this far). */
  subject: GateSubjectDtoSchema.nullable(),
  content: GateContentSchema.nullable(),
  /**
   * The checks on the subject: research and beat sheet run their agent's checks; scenes and
   * draft list the Curator's code findings on that version.
   */
  checks: z.array(GateIssueSchema),
  /** Scenes and draft: what the Curator left on each beat. */
  badges: z.array(GateBadgeSchema),
  /** Why it cannot be auto-approved (empty: nothing blocks). */
  blocking: z.array(z.string()),
  /** A still per beat of the subject version (data-dir relative); empty when none shows it. */
  stills: z.array(z.object({ beatId: z.string(), path: z.string() })),
  /** The joined draft of the subject version (data-dir relative), when it exists. */
  draftPath: z.string().nullable(),
  cost: RunCostDtoSchema,
});
export type GateDto = z.infer<typeof GateDtoSchema>;

const NotesSchema = z.string().trim().min(1).max(4_000);

/**
 * `POST /api/runs/:id/gates/:gate`: a decision on a gate the run waits at. Approve and edit name
 * the subject they were made on (`subjectId`, from `GET`): one that is no longer the gate's
 * subject is a 409.
 */
export const GateDecisionRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('approve'),
    subjectId: z.number().int().positive(),
    notes: NotesSchema.optional(),
  }),
  z.strictObject({ action: z.literal('reject'), notes: NotesSchema.optional() }),
  /**
   * `content`: the whole edited subject (research notes, beat sheet, or spec), saved as the user's
   * new step or spec version once it passes its schema (a 400 lists what fails).
   */
  z.strictObject({
    action: z.literal('edit'),
    subjectId: z.number().int().positive(),
    content: z.unknown(),
  }),
  z.strictObject({
    action: z.literal('regenerate'),
    target: RegenerateTargetSchema,
    beatId: z.string().trim().min(1).optional(),
    feedback: NotesSchema.optional(),
  }),
]);
export type GateDecisionRequest = z.input<typeof GateDecisionRequestSchema>;

/** The run after a decision, and for an edit what was saved and what its checks found. */
export const GateDecisionResponseSchema = z.object({
  run: z.object({ status: RunStatusSchema, step: PipelineStepIdSchema }),
  /** An edit's new step or spec version; null when it changed nothing (or for other actions). */
  saved: GateSubjectDtoSchema.nullable(),
  /** An edit's warnings and check findings (it was saved anyway). */
  issues: z.array(GateIssueSchema),
});
export type GateDecisionResponse = z.infer<typeof GateDecisionResponseSchema>;
