import { describe, expect, it } from 'vitest';
import { SettingsSchema, type SettingsInput } from '../config/settings.ts';
import {
  patchRunSettings,
  resolveRunSettings,
  RunSettingsConflictError,
} from './resolved-settings.ts';
import { RunSettingsPatchSchema, RunSettingsSchema, type RunSettingsInput } from './run.ts';

const resolve = (run: RunSettingsInput = {}, app: SettingsInput = {}) =>
  resolveRunSettings(RunSettingsSchema.parse(run), SettingsSchema.parse(app));

describe('resolveRunSettings', () => {
  it('uses the defaults without overrides', () => {
    const resolved = resolve();
    expect(resolved.video).toEqual({
      lengthMinSec: 45,
      lengthMaxSec: 150,
      lengthReasonAboveSec: 90,
      allowParts: true,
      maxParts: 4,
      wordsPerSec: 2.56,
      explanationLevel: 'beginner',
    });
    expect(resolved.timing).toEqual({ beatGapSec: 0, landingSec: 0, endTailSec: 0.5 });
    expect(resolved.tts).toEqual({ voice: 'af_heart', speed: 1 });
    expect(resolved.budget).toEqual({ maxRunUsd: 0.75 });
    expect(resolved.research).toEqual({ sourceTokenBudget: 60_000, disagreementBlocks: 'numbers' });
    expect(resolved.render.presets.draft).toEqual({ width: 540, height: 960, fps: 15 });
  });

  it('takes app settings over defaults, and run overrides over both, field by field', () => {
    const resolved = resolve(
      {
        video: { allowParts: false, wordsPerSec: 3, explanationLevel: 'expert' },
        timing: { landingSec: 0.6 },
        tts: { speed: 0.9 },
        budget: { maxRunUsd: 2 },
      },
      {
        video: { lengthMaxSec: 120, wordsPerSec: 2.5 },
        timing: { beatGapSec: 0.2 },
        tts: { voice: 'bf_emma', speed: 1.1 },
        budget: { maxRunUsd: 1 },
      },
    );
    expect(resolved.video).toMatchObject({
      lengthMaxSec: 120,
      allowParts: false,
      wordsPerSec: 3,
      maxParts: 4,
      explanationLevel: 'expert',
    });
    expect(resolved.timing).toEqual({ beatGapSec: 0.2, landingSec: 0.6, endTailSec: 0.5 });
    expect(resolved.tts).toEqual({ voice: 'bf_emma', speed: 0.9 });
    expect(resolved.budget.maxRunUsd).toBe(2);
  });

  it('takes the disagreement rule from the run, else the app, else "numbers"', () => {
    expect(resolve({}, { research: { disagreementBlocks: 'all' } }).research).toEqual({
      sourceTokenBudget: 60_000,
      disagreementBlocks: 'all',
    });
    expect(
      resolve(
        { research: { disagreementBlocks: 'none' } },
        { research: { disagreementBlocks: 'all', sourceTokenBudget: 9_000 } },
      ).research,
    ).toEqual({ sourceTokenBudget: 9_000, disagreementBlocks: 'none' });
    expect(() => resolve({ research: { sourceTokenBudget: 9_000 } } as never)).toThrow();
  });

  it("falls back to the app's speed, then to 1.0", () => {
    expect(resolve({}, { tts: { speed: 1.1 } }).tts.speed).toBe(1.1);
    expect(resolve().tts.speed).toBe(1);
  });

  it('keeps the model per role and its prices, and nothing of the machine', () => {
    const resolved = resolve(
      {},
      { llm: { apiKey: 'sk-secret', models: { director: 'deepseek-flash' } } },
    );
    expect(resolved.llm.models.director).toBe('deepseek-flash');
    expect(resolved.llm.prices['deepseek-flash']).toBeDefined();
    expect(JSON.stringify(resolved)).not.toContain('sk-secret');
    expect(resolved.llm).not.toHaveProperty('baseUrl');
    expect(resolved.llm).not.toHaveProperty('requestTimeoutSec');
  });

  it('rejects a run override that conflicts with the app settings', () => {
    expect(() => resolve({ video: { lengthMinSec: 160 } })).toThrow(RunSettingsConflictError);
  });
});

describe('resolveRunSettings: models', () => {
  it("takes a run's model per role over the app's", () => {
    const resolved = resolve({ llm: { models: { curator: 'deepseek-v4-pro' } } });
    expect(resolved.llm.models.curator).toBe('deepseek-v4-pro');
    expect(resolved.llm.models.scriptwriter).toBe('deepseek-flash');
  });
});

describe('patchRunSettings', () => {
  const settings = RunSettingsSchema.parse({ lengthOverrideSec: 60 });
  const snapshot = resolveRunSettings(settings, SettingsSchema.parse({}));
  /** The app as it is now: an edited price for the run's model, and a new model. */
  const app = SettingsSchema.parse({
    llm: {
      prices: {
        'deepseek-flash': { inputCacheHitPerMTok: 9, inputCacheMissPerMTok: 9, outputPerMTok: 9 },
        'deepseek-v4-pro': { inputCacheHitPerMTok: 9, inputCacheMissPerMTok: 9, outputPerMTok: 9 },
        '<example-model>': { inputCacheHitPerMTok: 1, inputCacheMissPerMTok: 2, outputPerMTok: 3 },
      },
    },
  });
  const priceOf = (model: string) => app.llm.prices[model];
  const patch = (value: unknown) =>
    patchRunSettings({ settings, snapshot }, RunSettingsPatchSchema.parse(value), priceOf);

  it("naming the Scriptwriter's model changes nothing else in the snapshot", () => {
    const next = patch({ llm: { models: { scriptwriter: '<example-model>' } } });
    expect(next.snapshot).toEqual({
      ...snapshot,
      llm: {
        models: { ...snapshot.llm.models, scriptwriter: '<example-model>' },
        // The new model's price only; the run's other prices stay as they were.
        prices: { ...snapshot.llm.prices, '<example-model>': app.llm.prices['<example-model>'] },
      },
    });
    expect(next.settings).toEqual({
      ...settings,
      llm: { models: { scriptwriter: '<example-model>' } },
    });
  });

  it('merges nested fields and gates one by one', () => {
    const next = patch({ video: { maxParts: 2 }, autoApprove: { scenes: true } });
    expect(next.snapshot.video).toEqual({ ...snapshot.video, maxParts: 2 });
    expect(next.settings.autoApprove).toEqual({ ...settings.autoApprove, scenes: true });
    expect(next.settings.lengthOverrideSec).toBe(60);
  });

  it('changes the disagreement rule in the overrides and the snapshot, and nothing else', () => {
    const next = patch({ research: { disagreementBlocks: 'none' } });
    expect(next.snapshot).toEqual({
      ...snapshot,
      research: { ...snapshot.research, disagreementBlocks: 'none' },
    });
    expect(next.settings).toEqual({ ...settings, research: { disagreementBlocks: 'none' } });
  });

  it('refuses a model with no price and a merge that breaks the rules', () => {
    expect(() => patch({ llm: { models: { director: '<example-unpriced>' } } })).toThrow(
      RunSettingsConflictError,
    );
    expect(() => patch({ video: { lengthMinSec: 160 } })).toThrow(RunSettingsConflictError);
  });

  it('an empty patch changes nothing', () => {
    expect(patch({})).toEqual({ settings, snapshot });
  });
});
