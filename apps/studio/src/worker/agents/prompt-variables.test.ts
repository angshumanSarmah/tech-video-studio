import { VideoSettingsSchema } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { PROMPT_VARIABLE_NAMES } from './prompt-variables.ts';

describe('PROMPT_VARIABLE_NAMES', () => {
  it('names one variable per video setting', () => {
    expect([...PROMPT_VARIABLE_NAMES].sort()).toEqual(
      Object.keys(VideoSettingsSchema.shape).sort(),
    );
  });
});
