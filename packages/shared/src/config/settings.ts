import { z } from 'zod';
import { END_TAIL_SEC } from '../spec/effective-timing.ts';
import { LlmSettingsSchema } from './llm.ts';
import { VideoSettingsSchema } from './video.ts';

/** Kokoro's speed multiplier (1 = the voice's natural pace). */
export const TtsSpeedSchema = z.number().min(0.5).max(2);

export const TtsSettingsSchema = z.strictObject({
  /** Python interpreter of the Kokoro env. Relative paths resolve from the repo root. */
  binaryPath: z.string().trim().min(1).default('apps/studio/tts-python/.venv/bin/python'),
  voice: z.string().trim().min(1).default('af_heart'),
  /** Default narration pace; a run's `settings.tts.speed` overrides it. */
  speed: TtsSpeedSchema.default(1),
});

export type TtsSettings = z.infer<typeof TtsSettingsSchema>;

/** A pause in seconds on the narration track (the audio gets matching silence). */
export const PauseSecSchema = z.number().min(0).max(3);

/**
 * Pauses the timing step puts on the narration track, as silence the visuals hold through. Every
 * value flows into the timing layer (`timing.pauses`, beat starts and `timing.endSec`); a run's
 * `settings.timing` overrides any of them.
 */
export const TimingSettingsSchema = z.strictObject({
  /** Silence between one beat's narration (or landing hold) and the next beat. */
  beatGapSec: PauseSecSchema.default(0),
  /**
   * Hold after a beat's last event has settled (played out, draws included) before the next beat
   * starts: the finished board stays on screen. 0 = off. Applies once the beat has scenes.
   */
  landingSec: PauseSecSchema.default(0),
  /** Held after the last beat so the video does not cut on the final word. */
  endTailSec: PauseSecSchema.default(END_TAIL_SEC),
});

export type TimingSettings = z.infer<typeof TimingSettingsSchema>;

const EvenDimensionSchema = z
  .number()
  .int()
  .positive()
  .multipleOf(2, 'Must be an even number of pixels (H.264 requirement)');

export const RenderPresetSchema = z.strictObject({
  width: EvenDimensionSchema,
  height: EvenDimensionSchema,
  fps: z.number().int().min(1).max(60),
});

export type RenderPreset = z.infer<typeof RenderPresetSchema>;

export const RenderSettingsSchema = z.strictObject({
  /**
   * Frames rendered in parallel within one render job (one Chrome tab each). Jobs themselves run
   * one at a time. The default suits a 16 GB laptop; `bench:render` reports peak memory.
   */
  concurrency: z.number().int().min(1).max(16).default(3),
  presets: z
    .strictObject({
      draft: RenderPresetSchema.default({ width: 540, height: 960, fps: 15 }),
      final: RenderPresetSchema.default({ width: 1080, height: 1920, fps: 30 }),
    })
    .prefault({}),
});

export type RenderSettings = z.infer<typeof RenderSettingsSchema>;

/**
 * Editable app settings persisted in `<dataDir>/config.json`. Every field has a default, so `{}`
 * (or a missing file) is a complete config. Unknown keys are rejected so typos fail loudly.
 * Bootstrap values (data dir, port) live in `EnvSchema` because they locate this file.
 */
export const SettingsSchema = z.strictObject({
  llm: LlmSettingsSchema.prefault({}),
  tts: TtsSettingsSchema.prefault({}),
  timing: TimingSettingsSchema.prefault({}),
  render: RenderSettingsSchema.prefault({}),
  /** Length, parts and pace: the values agent prompts are filled with. */
  video: VideoSettingsSchema.prefault({}),
});

/** Validated settings with defaults applied. */
export type Settings = z.infer<typeof SettingsSchema>;
/** What callers may pass in (any subset; defaults fill the rest). */
export type SettingsInput = z.input<typeof SettingsSchema>;
