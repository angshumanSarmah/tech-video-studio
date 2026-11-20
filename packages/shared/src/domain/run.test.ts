import { describe, expect, it } from 'vitest';
import { AutoApproveSchema, GATE_IDS, RunSettingsSchema } from './run.ts';

describe('RunSettingsSchema', () => {
  it('defaults every gate to manual review and no length override', () => {
    expect(RunSettingsSchema.parse({})).toEqual({
      autoApprove: { research: false, beat_sheet: false, scenes: false, draft: false },
    });
  });

  it('has one auto-approve flag per gate', () => {
    expect(Object.keys(AutoApproveSchema.shape).sort()).toEqual([...GATE_IDS].sort());
  });

  it('keeps a partial auto-approve override and fills the rest', () => {
    const settings = RunSettingsSchema.parse({
      autoApprove: { research: true },
      lengthOverrideSec: 60,
    });
    expect(settings.autoApprove).toEqual({
      research: true,
      beat_sheet: false,
      scenes: false,
      draft: false,
    });
    expect(settings.lengthOverrideSec).toBe(60);
  });

  it.each([14, 171, 60.5])('rejects length override %s', (lengthOverrideSec) => {
    expect(RunSettingsSchema.safeParse({ lengthOverrideSec }).success).toBe(false);
  });

  it('keeps a per-run TTS speed override', () => {
    expect(RunSettingsSchema.parse({ tts: { speed: 1.15 } }).tts).toEqual({ speed: 1.15 });
    expect(RunSettingsSchema.parse({ tts: {} }).tts).toEqual({});
  });

  it('keeps per-run timing pause overrides without filling the rest', () => {
    expect(RunSettingsSchema.parse({ timing: { landingSec: 0.6 } }).timing).toEqual({
      landingSec: 0.6,
    });
    expect(RunSettingsSchema.safeParse({ timing: { beatGapSec: 4 } }).success).toBe(false);
  });

  it.each([0.4, 2.1])('rejects TTS speed %s', (speed) => {
    expect(RunSettingsSchema.safeParse({ tts: { speed } }).success).toBe(false);
  });

  it('rejects unknown gates', () => {
    expect(RunSettingsSchema.safeParse({ autoApprove: { publish: true } }).success).toBe(false);
  });
});
