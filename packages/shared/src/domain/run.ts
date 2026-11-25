import { z } from 'zod';
import { ModelRoleSchema } from '../config/llm.ts';
import {
  DisagreementBlocksSchema,
  PauseSecSchema,
  RunCostCapSchema,
  TtsSpeedSchema,
} from '../config/settings.ts';
import { VideoLengthSecSchema, VideoSettingsOverrideSchema } from '../config/video.ts';
import { VideoFormatSchema } from '../spec/meta.ts';

/** Pipeline stages, in execution order. Exhaustive. */
export const STAGES = [
  'ingest',
  'research',
  'direct',
  'script',
  'tts',
  'generate',
  'curate',
  /** The Curator's repairs of single beats (P1C.8): Scriptwriter, narration, boards, re-time. */
  'repair',
  'draft_render',
  'final_render',
] as const;
export const StageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof StageSchema>;

/** Review gates, in pipeline order. Exhaustive. */
export const GATE_IDS = ['research', 'beat_sheet', 'scenes', 'draft'] as const;
export const GateIdSchema = z.enum(GATE_IDS);
export type GateId = z.infer<typeof GateIdSchema>;

export const RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_review',
  /** Stopped by its cost cap (`budget.maxRunUsd`); raising the cap resumes it. */
  'paused',
  'done',
  'failed',
  'cancelled',
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export const StepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const GATE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const GateStatusSchema = z.enum(GATE_STATUSES);
export type GateStatus = z.infer<typeof GateStatusSchema>;

/** Who decided a gate. */
export const DECIDED_BY = ['auto', 'user'] as const;
export const DecidedBySchema = z.enum(DECIDED_BY);
export type DecidedBy = z.infer<typeof DecidedBySchema>;

/** Who produced a spec version. `external` = imported from a chat model (P1C.14). */
export const SPEC_AUTHORS = ['agent', 'user', 'external'] as const;
export const SpecAuthorSchema = z.enum(SPEC_AUTHORS);
export type SpecAuthor = z.infer<typeof SpecAuthorSchema>;

const autoApprove = (): z.ZodDefault<z.ZodBoolean> => z.boolean().default(false);

/** Keys must match GATE_IDS (checked by test). */
export const AutoApproveSchema = z.strictObject({
  research: autoApprove(),
  beat_sheet: autoApprove(),
  scenes: autoApprove(),
  draft: autoApprove(),
});

/** Per-run settings, stored as JSON on the run row. */
export const RunSettingsSchema = z.strictObject({
  autoApprove: AutoApproveSchema.prefault({}),
  /**
   * Target length in seconds, within the hard limits; omitted means the Director decides within
   * the configured range (`settings.video`).
   */
  lengthOverrideSec: VideoLengthSecSchema.optional(),
  /**
   * `meta.format` for this run (`full` or `card`); omitted means the Director's recommendation
   * (`plan.meta.format`) is used.
   */
  format: VideoFormatSchema.optional(),
  /** Per-run TTS overrides; anything omitted falls back to the app's `settings.tts`. */
  tts: z.strictObject({ speed: TtsSpeedSchema.optional() }).optional(),
  /** Per-run pause overrides (`TimingSettingsSchema`); omitted fields use the app's. */
  timing: z
    .strictObject({
      beatGapSec: PauseSecSchema.optional(),
      landingSec: PauseSecSchema.optional(),
      endTailSec: PauseSecSchema.optional(),
    })
    .optional(),
  /** Per-run length, parts and pace overrides (`VideoSettingsSchema`); omitted fields use the app's. */
  video: VideoSettingsOverrideSchema.optional(),
  /** Per-run research overrides; omitted fields use the app's `settings.research`. */
  research: z.strictObject({ disagreementBlocks: DisagreementBlocksSchema.optional() }).optional(),
  /** Per-run cost cap; omitted uses the app's `budget.maxRunUsd`. */
  budget: z.strictObject({ maxRunUsd: RunCostCapSchema.optional() }).optional(),
  /** Per-run model per role; omitted roles use the app's `llm.models`. */
  llm: z
    .strictObject({ models: z.partialRecord(ModelRoleSchema, z.string().trim().min(1)) })
    .optional(),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;
export type RunSettingsInput = z.input<typeof RunSettingsSchema>;

/**
 * A change to a run's settings (`PUT /api/runs/:id/settings`): only the fields it names, each
 * merged onto the run's overrides and its snapshot (`patchRunSettings`). Same fields as
 * `RunSettingsSchema`, every one optional, `autoApprove` per gate.
 */
export const RunSettingsPatchSchema = RunSettingsSchema.extend({
  autoApprove: z.partialRecord(GateIdSchema, z.boolean()).optional(),
}).partial();
export type RunSettingsPatch = z.infer<typeof RunSettingsPatchSchema>;
