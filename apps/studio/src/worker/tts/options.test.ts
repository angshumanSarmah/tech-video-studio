import { RunSettingsSchema, TtsSettingsSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { resolveTtsOptions } from './options.ts';

const app = TtsSettingsSchema.parse({ voice: 'bf_emma', speed: 1.1 });

describe('resolveTtsOptions', () => {
  it("uses the run's speed override first", () => {
    const run = RunSettingsSchema.parse({ tts: { speed: 0.9 } });
    expect(resolveTtsOptions(run, app)).toEqual({ voice: 'bf_emma', speed: 0.9 });
  });

  it('falls back to the app setting, then to 1.0', () => {
    expect(resolveTtsOptions(RunSettingsSchema.parse({}), app).speed).toBe(1.1);
    expect(resolveTtsOptions(undefined, TtsSettingsSchema.parse({})).speed).toBe(1);
  });
});
