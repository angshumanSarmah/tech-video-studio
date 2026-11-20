import { RunSettingsSchema, SettingsSchema, VideoSettingsSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  PROMPT_VARIABLE_NAMES,
  PromptVariablesError,
  resolvePromptVariables,
} from './prompt-variables.ts';

const appDefaults = SettingsSchema.parse({}).video;

describe('resolvePromptVariables', () => {
  it('names one variable per video setting', () => {
    expect([...PROMPT_VARIABLE_NAMES].sort()).toEqual(
      Object.keys(VideoSettingsSchema.shape).sort(),
    );
  });

  it('uses the defaults 45, 150, 90, true, 4, 2.7, beginner without overrides', () => {
    expect(resolvePromptVariables(undefined, appDefaults)).toEqual({
      lengthMinSec: 45,
      lengthMaxSec: 150,
      lengthReasonAboveSec: 90,
      allowParts: true,
      maxParts: 4,
      wordsPerSec: 2.7,
      explanationLevel: 'beginner',
    });
  });

  it('takes the run’s explanation level over the app’s', () => {
    const run = RunSettingsSchema.parse({ video: { explanationLevel: 'expert' } });
    expect(resolvePromptVariables(run, appDefaults).explanationLevel).toBe('expert');
  });

  it('takes app settings over defaults, and the run override over both', () => {
    const app = VideoSettingsSchema.parse({ lengthMaxSec: 120, wordsPerSec: 2.5 });
    const run = RunSettingsSchema.parse({ video: { allowParts: false, wordsPerSec: 3 } });
    expect(resolvePromptVariables(run, app)).toMatchObject({
      lengthMaxSec: 120,
      allowParts: false,
      wordsPerSec: 3,
      maxParts: 4,
    });
  });

  it('rejects a run override that conflicts with the app settings', () => {
    const run = RunSettingsSchema.parse({ video: { lengthMinSec: 160 } });
    expect(() => resolvePromptVariables(run, appDefaults)).toThrow(PromptVariablesError);
  });
});
