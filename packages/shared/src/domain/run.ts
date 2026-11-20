import { z } from 'zod';
import { TtsSpeedSchema } from '../config/settings.ts';

/** Pipeline stages, in execution order. Exhaustive. */
export const STAGES = [
  'ingest',
  'research',
  'direct',
  'script',
  'tts',
  'generate',
  'curate',
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

export const SHORT_LENGTH_SEC = { min: 45, max: 90 } as const;

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
  /** Target length in seconds; omitted means the Director decides within 45–90 s. */
  lengthOverrideSec: z
    .number()
    .int()
    .min(SHORT_LENGTH_SEC.min)
    .max(SHORT_LENGTH_SEC.max)
    .optional(),
  /** Per-run TTS overrides; anything omitted falls back to the app's `settings.tts`. */
  tts: z.strictObject({ speed: TtsSpeedSchema.optional() }).optional(),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;
export type RunSettingsInput = z.input<typeof RunSettingsSchema>;
