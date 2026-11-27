import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';
import { BeatSceneSchema } from '../spec/scene.ts';
import { MissingPrimitiveRequestSchema } from '../spec/story.ts';

/**
 * The files a `generate` job writes (P1C.7): one input and one output per job (a whole-stage
 * `run_steps` row), and one input and one board per beat attempt (a row with `beat_id`). Gate 3
 * reads the job output's warnings.
 */

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Why a beat step ran. */
export const BEAT_STEP_REASONS = [
  /** The beat's first board in this run (or its input changed). */
  'generate',
  /** A gate asked for this beat again. */
  'regenerate',
  /** An earlier beat of its board was regenerated and this board no longer passed its checks. */
  'revalidate',
  /** The post-pass found an issue across boards: one targeted retry. */
  'retry',
] as const;
export const BeatStepReasonSchema = z.enum(BEAT_STEP_REASONS);
export type BeatStepReason = z.infer<typeof BeatStepReasonSchema>;

export const GeneratorBeatInputSchema = z.strictObject({
  beatId: SpecIdSchema,
  beatIndex: z.number().int().min(0),
  reason: BeatStepReasonSchema,
  /**
   * sha256 of the model, prompt versions and messages (plus a regenerate's job id): a finished
   * step with the same hash is reused instead of calling the model again.
   */
  inputHash: Sha256Schema,
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  feedback: z.string().nullable(),
});
export type GeneratorBeatInput = z.infer<typeof GeneratorBeatInputSchema>;

/** A near-identical asset id the step swapped for an approved one, at a path in the answer. */
export const AssetSwapRecordSchema = z.strictObject({
  path: z.string(),
  from: z.string(),
  to: z.string(),
});
export type AssetSwapRecord = z.infer<typeof AssetSwapRecordSchema>;

export const GeneratorBeatOutputSchema = z.strictObject({
  scene: BeatSceneSchema,
  swaps: z.array(AssetSwapRecordSchema),
  missingPrimitiveRequests: z.array(MissingPrimitiveRequestSchema),
});
export type GeneratorBeatOutput = z.infer<typeof GeneratorBeatOutputSchema>;

export const GenerateInputSchema = z.strictObject({
  /** The pinned spec version the boards are drawn for. */
  specVersionId: z.number().int().positive(),
  /** Regenerate only this beat (and what it breaks); null for the whole video. */
  beatId: SpecIdSchema.nullable(),
  feedback: z.string().nullable(),
  /** Every beat drawn again (a gate's regenerate of the Generator): no beat step is reused. */
  redraw: z.boolean().optional(),
  directStepId: z.number().int().positive(),
  researchStepId: z.number().int().positive(),
  model: z.string().min(1),
  styleRules: z.array(z.string()),
});
export type GenerateInput = z.infer<typeof GenerateInputSchema>;

/** What happened to a beat in this job. */
export const BEAT_OUTCOMES = [
  /** A finished step with the same input was reused (no call). */
  'reused',
  /** The model drew it in this job. */
  'generated',
  /** Kept from the pinned spec (a regenerate that did not need it). */
  'kept',
] as const;
export const BeatOutcomeSchema = z.enum(BEAT_OUTCOMES);
export type BeatOutcome = z.infer<typeof BeatOutcomeSchema>;

/** An issue left on a beat's board after the post-pass; the path is into that board. */
export const GenerateWarningSchema = z.strictObject({
  beatId: SpecIdSchema,
  path: z.string(),
  code: z.string().nullable(),
  message: z.string(),
  /** Advisory (an unknown asset drawn as a placeholder). */
  soft: z.boolean(),
});
export type GenerateWarning = z.infer<typeof GenerateWarningSchema>;

/**
 * An icon unified by the post-pass (P1C.12): one thing (the same normalised title or label) drawn
 * with another asset on other beats takes the id used most.
 */
export const IconSwapRecordSchema = z.strictObject({
  beatId: SpecIdSchema,
  path: z.string(),
  title: z.string(),
  from: z.string(),
  to: z.string(),
  /** The beat was drawn again because the swap left a new issue on its board. */
  redrawn: z.boolean(),
});
export type IconSwapRecord = z.infer<typeof IconSwapRecordSchema>;

export const GenerateOutputSchema = z.strictObject({
  /** The spec version saved with the boards. */
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
  beats: z.array(
    z.strictObject({
      beatId: SpecIdSchema,
      /** The beat step whose board the spec holds; null when kept from the pinned spec. */
      stepId: z.number().int().positive().nullable(),
      outcome: BeatOutcomeSchema,
      /** The post-pass retried it. */
      retried: z.boolean(),
    }),
  ),
  warnings: z.array(GenerateWarningSchema),
  /** Icons the post-pass unified across beats (older outputs have none). */
  iconSwaps: z.array(IconSwapRecordSchema).default([]),
  /** This job's calls only (reused beats cost nothing here). */
  usage: z.strictObject({
    calls: z.number().int().min(0),
    costUsd: z.number().min(0),
    inCached: z.number().int().min(0),
    inUncached: z.number().int().min(0),
    out: z.number().int().min(0),
  }),
});
export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;
