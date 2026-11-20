import { z } from 'zod';

/**
 * Hard limits on a video's length in seconds. The cap keeps every video under both platforms'
 * 3-minute limit. Validation enforces them (`meta.targetLengthSec`, the timed track); prompts
 * only state the configured range.
 */
export const VIDEO_LENGTH_LIMITS_SEC = { min: 15, max: 170 } as const;

export const VideoLengthSecSchema = z
  .number()
  .int()
  .min(VIDEO_LENGTH_LIMITS_SEC.min)
  .max(VIDEO_LENGTH_LIMITS_SEC.max);

/**
 * How much the video explains (`{{explanationLevel}}` in the preamble): beginner = every topic
 * term in plain words; intermediate = only uncommon terms; expert = the topic's basics assumed.
 */
export const EXPLANATION_LEVELS = ['beginner', 'intermediate', 'expert'] as const;
export const ExplanationLevelSchema = z.enum(EXPLANATION_LEVELS);
export type ExplanationLevel = z.infer<typeof ExplanationLevelSchema>;

/** App defaults for the values agent prompts are filled with (`{{name}}` in the prompt files). */
export const DEFAULT_VIDEO_SETTINGS = {
  lengthMinSec: 45,
  lengthMaxSec: 150,
  lengthReasonAboveSec: 90,
  allowParts: true,
  maxParts: 4,
  wordsPerSec: 2.7,
  explanationLevel: 'beginner',
} as const;

/** One field per prompt variable, without defaults (the run override reuses them). */
const videoFields = {
  /** Shortest length the Director plans. */
  lengthMinSec: VideoLengthSecSchema,
  /** Longest length the Director plans (per part in a multi-part video). */
  lengthMaxSec: VideoLengthSecSchema,
  /** Above this, the Director must give a one-line reason in the plan. */
  lengthReasonAboveSec: VideoLengthSecSchema,
  /** Whether a big topic may be split into parts (each its own video). */
  allowParts: z.boolean(),
  maxParts: z.number().int().min(2).max(6),
  /** The Scriptwriter's narration pace (Kokoro at speed 1.0 is about 2.7). */
  wordsPerSec: z.number().min(1.5).max(4),
  /** Who the video is for; every agent's preamble states it. */
  explanationLevel: ExplanationLevelSchema,
};

type VideoOrderInput = { lengthMinSec: number; lengthMaxSec: number; lengthReasonAboveSec: number };

function checkLengthOrder(video: VideoOrderInput, ctx: z.RefinementCtx): void {
  if (video.lengthMinSec > video.lengthReasonAboveSec) {
    ctx.addIssue({
      code: 'custom',
      path: ['lengthReasonAboveSec'],
      message: 'lengthReasonAboveSec must be at least lengthMinSec',
    });
  }
  if (video.lengthReasonAboveSec > video.lengthMaxSec) {
    ctx.addIssue({
      code: 'custom',
      path: ['lengthMaxSec'],
      message: 'lengthMaxSec must be at least lengthReasonAboveSec',
    });
  }
}

/** App settings for length, parts, pace and explanation level; every field has a default. */
export const VideoSettingsSchema = z
  .strictObject({
    lengthMinSec: videoFields.lengthMinSec.default(DEFAULT_VIDEO_SETTINGS.lengthMinSec),
    lengthMaxSec: videoFields.lengthMaxSec.default(DEFAULT_VIDEO_SETTINGS.lengthMaxSec),
    lengthReasonAboveSec: videoFields.lengthReasonAboveSec.default(
      DEFAULT_VIDEO_SETTINGS.lengthReasonAboveSec,
    ),
    allowParts: videoFields.allowParts.default(DEFAULT_VIDEO_SETTINGS.allowParts),
    maxParts: videoFields.maxParts.default(DEFAULT_VIDEO_SETTINGS.maxParts),
    wordsPerSec: videoFields.wordsPerSec.default(DEFAULT_VIDEO_SETTINGS.wordsPerSec),
    explanationLevel: videoFields.explanationLevel.default(DEFAULT_VIDEO_SETTINGS.explanationLevel),
  })
  .superRefine(checkLengthOrder);

export type VideoSettings = z.infer<typeof VideoSettingsSchema>;

/**
 * A run's overrides; omitted fields use the app's. The merged result is checked again
 * (`VideoSettingsSchema`), so the order rule holds across both.
 */
export const VideoSettingsOverrideSchema = z.strictObject(videoFields).partial();
export type VideoSettingsOverride = z.infer<typeof VideoSettingsOverrideSchema>;
