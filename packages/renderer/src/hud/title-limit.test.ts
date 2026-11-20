import { TITLE_MAX_CHARS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec, withFormat } from '../../fixtures/index.ts';
import { roomInChars, textWidth } from '../fonts/measure-text.ts';
import { getTheme } from '../theme/index.ts';
import { subjectText, titleBlockSlots } from './hud-slots.ts';
import { TITLE_LINES } from './title-block.ts';

/** The longest seeded series label (`apps/studio/src/core/db/seed.ts`). */
const LONGEST_SERIES_LABEL = 'SYSTEM DESIGN';

describe('TITLE_MAX_CHARS', () => {
  it('is what the narrowest title slot of the default theme holds', () => {
    const theme = getTheme();
    // The strip's subject line: "SERIES · TITLE" on one line.
    const prefix = textWidth(theme, 'hud', subjectText(LONGEST_SERIES_LABEL, ''));
    const strip = titleBlockSlots(theme, 'strip', goldenRateLimiterSpec).subject - prefix;
    // The card header: the title alone, in display type, over `TITLE_LINES` lines.
    const card = titleBlockSlots(theme, 'header', withFormat(goldenRateLimiterSpec, 'card')).title;
    const fits = [
      roomInChars(theme, 'hud', strip),
      roomInChars(theme, 'title', card) * TITLE_LINES,
    ];
    expect(TITLE_MAX_CHARS).toBe(Math.min(...fits));
  });
});
