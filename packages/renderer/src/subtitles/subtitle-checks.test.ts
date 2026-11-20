import { describe, expect, it } from 'vitest';
import { allFixtureSpecs, rateLimiterSpec } from '../../fixtures/index.ts';
import { getTheme, listThemes } from '../theme/index.ts';
import { SUBTITLE_WORD_TOO_WIDE, subtitleWarnings } from './subtitle-checks.ts';

const paper = getTheme('drafting-paper');

describe('subtitleWarnings', () => {
  it.each(listThemes().map((t) => t.id))('finds nothing in the fixtures (%s)', (themeId) => {
    for (const spec of allFixtureSpecs)
      expect(subtitleWarnings(spec, getTheme(themeId))).toEqual([]);
  });

  it("warns once per word too wide for a line, at its beat's narration", () => {
    const word = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
    const script = rateLimiterSpec.script.map((beat, i) =>
      i === 2 ? { ...beat, narration: `${word} again: ${word}.` } : beat,
    );
    const warnings = subtitleWarnings({ ...rateLimiterSpec, script }, paper);
    expect(warnings.map((w) => [w.path, w.code])).toEqual([
      ['$.script[2].narration', SUBTITLE_WORD_TOO_WIDE],
      ['$.script[2].narration', SUBTITLE_WORD_TOO_WIDE],
    ]);
    expect(warnings[0]!.message).toMatch(/Beat "bucket-empty": "Pneumono.*" is \d+ px wide/);
  });
});
