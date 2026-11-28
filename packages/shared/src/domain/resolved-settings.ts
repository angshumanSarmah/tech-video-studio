import { z } from 'zod';
import { ModelMapSchema, PriceTableSchema } from '../config/llm.ts';
import {
  AssetSettingsSchema,
  BudgetSettingsSchema,
  RenderPresetSchema,
  ResearchSettingsSchema,
  TimingSettingsSchema,
  TtsSpeedSchema,
  type Settings,
} from '../config/settings.ts';
import { VideoSettingsSchema } from '../config/video.ts';
import type { RunSettings, RunSettingsPatch } from './run.ts';
import type { ModelPrice } from '../config/llm.ts';

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
  /** Asset drafting (P1C.12); snapshots from before it read the default. */
  assets: AssetSettingsSchema.prefault({}),
});

export type ResolvedRunSettings = z.infer<typeof ResolvedRunSettingsSchema>;

/** The app settings a run resolves from (`Settings`, or the process config, which holds them). */
export type RunSettingsSource = Pick<
  Settings,
  'video' | 'timing' | 'research' | 'budget' | 'assets'
> & {
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
    research: { ...app.research, ...run.research },
    llm: { models: { ...app.llm.models, ...run.llm?.models }, prices: app.llm.prices },
    render: { presets: app.render.presets },
    budget: { maxRunUsd: run.budget?.maxRunUsd ?? app.budget.maxRunUsd },
    assets: app.assets,
  });
  if (!result.success) {
    throw new RunSettingsConflictError(
      `The run's overrides conflict with the app settings:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export interface PatchedRunSettings {
  readonly settings: RunSettings;
  readonly snapshot: ResolvedRunSettings;
}

/**
 * Pure: `patch` merged onto a run's overrides and onto its snapshot, field by field; nothing it
 * does not name changes, and the app settings are never re-read. A model the snapshot has no
 * price for takes its price from `priceOf` (the app's price table, for that model only); none
 * there is a `RunSettingsConflictError`, like a merge that breaks the snapshot's rules.
 */
export function patchRunSettings(
  current: PatchedRunSettings,
  patch: RunSettingsPatch,
  priceOf: (model: string) => ModelPrice | undefined,
): PatchedRunSettings {
  const { settings, snapshot } = current;
  const merged: RunSettings = {
    ...settings,
    ...withoutUndefined(patch),
    autoApprove: { ...settings.autoApprove, ...withoutUndefined(patch.autoApprove ?? {}) },
    ...mergedObject('tts', settings.tts, patch.tts),
    ...mergedObject('timing', settings.timing, patch.timing),
    ...mergedObject('video', settings.video, patch.video),
    ...mergedObject('budget', settings.budget, patch.budget),
    ...mergedObject('research', settings.research, patch.research),
    ...(patch.llm
      ? { llm: { models: { ...settings.llm?.models, ...withoutUndefined(patch.llm.models) } } }
      : settings.llm
        ? { llm: settings.llm }
        : {}),
  };
  const models = { ...snapshot.llm.models, ...withoutUndefined(patch.llm?.models ?? {}) };
  const result = ResolvedRunSettingsSchema.safeParse({
    ...snapshot,
    video: { ...snapshot.video, ...withoutUndefined(patch.video ?? {}) },
    timing: { ...snapshot.timing, ...withoutUndefined(patch.timing ?? {}) },
    tts: { ...snapshot.tts, ...withoutUndefined(patch.tts ?? {}) },
    budget: { ...snapshot.budget, ...withoutUndefined(patch.budget ?? {}) },
    research: { ...snapshot.research, ...withoutUndefined(patch.research ?? {}) },
    llm: { models, prices: pricesFor(snapshot.llm.prices, Object.values(models), priceOf) },
  });
  if (!result.success) {
    throw new RunSettingsConflictError(
      `The change conflicts with the run's settings:\n${z.prettifyError(result.error)}`,
    );
  }
  return { settings: merged, snapshot: result.data };
}

/** The snapshot's prices, plus the app's price of each model it has none for. */
function pricesFor(
  prices: ResolvedRunSettings['llm']['prices'],
  models: readonly string[],
  priceOf: (model: string) => ModelPrice | undefined,
): ResolvedRunSettings['llm']['prices'] {
  const added = models.filter((m) => !(m in prices));
  const next = { ...prices };
  for (const model of added) {
    const price = priceOf(model);
    if (!price) {
      throw new RunSettingsConflictError(
        `Model "${model}" has no price in the app's price table (settings.llm.prices): add one first.`,
      );
    }
    next[model] = price;
  }
  return next;
}

/** A nested override merged, or left out when neither side has it. */
function mergedObject<K extends string, T extends object>(
  key: K,
  current: T | undefined,
  patch: T | undefined,
): Partial<Record<K, T>> {
  if (!patch) return current ? ({ [key]: current } as Record<K, T>) : {};
  return { [key]: { ...current, ...withoutUndefined(patch) } } as Record<K, T>;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
