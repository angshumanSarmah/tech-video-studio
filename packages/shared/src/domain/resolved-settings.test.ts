import { describe, expect, it } from 'vitest';
import { SettingsSchema, type SettingsInput } from '../config/settings.ts';
import { resolveRunSettings, RunSettingsConflictError } from './resolved-settings.ts';
import { RunSettingsSchema, type RunSettingsInput } from './run.ts';

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
    expect(resolved.research.sourceTokenBudget).toBe(60_000);
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
