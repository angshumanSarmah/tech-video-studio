import { z } from 'zod';
import { LlmSettingsSchema } from './llm.ts';

export const TtsSettingsSchema = z.strictObject({
  /** Python interpreter of the Kokoro env. Relative paths resolve from the repo root. */
  binaryPath: z.string().trim().min(1).default('apps/studio/tts-python/.venv/bin/python'),
  voice: z.string().trim().min(1).default('af_heart'),
  speed: z.number().min(0.5).max(2).default(1),
});

export type TtsSettings = z.infer<typeof TtsSettingsSchema>;

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
  /** Frames rendered in parallel within one render job. Jobs themselves run one at a time. */
  concurrency: z.number().int().min(1).max(16).default(4),
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
  render: RenderSettingsSchema.prefault({}),
});

/** Validated settings with defaults applied. */
export type Settings = z.infer<typeof SettingsSchema>;
/** What callers may pass in (any subset; defaults fill the rest). */
export type SettingsInput = z.input<typeof SettingsSchema>;
