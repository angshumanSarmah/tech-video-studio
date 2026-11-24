import { z } from 'zod';
import { ModelMapSchema, PriceTableSchema } from '../config/llm.ts';
import {
  BudgetSettingsSchema,
  RenderPresetSchema,
  ResearchSettingsSchema,
  TimingSettingsSchema,
  TtsSpeedSchema,
  type Settings,
} from '../config/settings.ts';
import { VideoSettingsSchema } from '../config/video.ts';
import type { RunSettings } from './run.ts';

/**
 * A run's settings, resolved once when it starts (P1C.9): each run override, else the app setting,
 * else the default. Every job of the run reads these, so editing the app settings mid-run never
 * changes its prompts, timing, narration, renders or prices. Machine settings (the API key and
 * base URL, timeouts, concurrency, the Python path) are not part of it: they belong to the process.
 */
export const ResolvedRunSettingsSchema = z.strictObject({
  /** Length, parts, pace and level: the prompt variables. */
  video: VideoSettingsSchema,
  /** Pauses on the narration track. */
  timing: TimingSettingsSchema,
  /** Narration voice and speed. */
  tts: z.strictObject({ voice: z.string().trim().min(1), speed: TtsSpeedSchema }),
  research: ResearchSettingsSchema,
  /** The model per role and the price table its cost is computed with. */
  llm: z.strictObject({ models: ModelMapSchema, prices: PriceTableSchema }),
  render: z.strictObject({
    presets: z.strictObject({ draft: RenderPresetSchema, final: RenderPresetSchema }),
  }),
  budget: BudgetSettingsSchema,
});

export type ResolvedRunSettings = z.infer<typeof ResolvedRunSettingsSchema>;

/** The app settings a run resolves from (`Settings`, or the process config, which holds them). */
export type RunSettingsSource = Pick<Settings, 'video' | 'timing' | 'research' | 'budget'> & {
  readonly tts: Pick<Settings['tts'], 'voice' | 'speed'>;
  readonly llm: Pick<Settings['llm'], 'models' | 'prices'>;
  readonly render: Pick<Settings['render'], 'presets'>;
};

/** A run's overrides that cannot hold with the app settings (e.g. a minimum above the maximum). */
export class RunSettingsConflictError extends Error {
  override readonly name = 'RunSettingsConflictError';
}

/** Pure: the run's overrides over the app settings, validated as a whole. */
export function resolveRunSettings(run: RunSettings, app: RunSettingsSource): ResolvedRunSettings {
  const result = ResolvedRunSettingsSchema.safeParse({
    video: { ...app.video, ...run.video },
    timing: { ...app.timing, ...run.timing },
    tts: { voice: app.tts.voice, speed: run.tts?.speed ?? app.tts.speed },
    research: app.research,
    llm: { models: app.llm.models, prices: app.llm.prices },
    render: { presets: app.render.presets },
    budget: { maxRunUsd: run.budget?.maxRunUsd ?? app.budget.maxRunUsd },
  });
  if (!result.success) {
    throw new RunSettingsConflictError(
      `The run's overrides conflict with the app settings:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
