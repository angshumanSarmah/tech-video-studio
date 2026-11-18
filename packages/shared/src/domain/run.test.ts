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

  it.each([44, 91, 60.5])('rejects length override %s', (lengthOverrideSec) => {
    expect(RunSettingsSchema.safeParse({ lengthOverrideSec }).success).toBe(false);
  });

  it('rejects unknown gates', () => {
    expect(RunSettingsSchema.safeParse({ autoApprove: { publish: true } }).success).toBe(false);
  });
});
