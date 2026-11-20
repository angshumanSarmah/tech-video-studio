import { CHAPTER_TITLE_MAX_CHARS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec, withFormat } from '../../fixtures/index.ts';
import { roomInChars } from '../fonts/measure-text.ts';
import { getTheme } from '../theme/index.ts';
import { titleBlockSlots } from './hud-slots.ts';

describe('CHAPTER_TITLE_MAX_CHARS', () => {
  it('is what the narrowest chapter-title slot of the default theme holds', () => {
    const theme = getTheme();
    // No hero metric or story clock shares a row: the room a title always has.
    const story = { ...goldenRateLimiterSpec.story, heroMetric: undefined };
    const full = { ...goldenRateLimiterSpec, story };
    const card = withFormat(full, 'card');
    const rooms = [
      // The step name (chapter header off), in the strip and the card header.
      titleBlockSlots(theme, 'strip', full).stepName,
      titleBlockSlots(theme, 'header', card).stepName,
      // The card viewport's label cell, which shows the title while the chapter header is on.
      titleBlockSlots(theme, 'header', card).viewportLabel,
    ];
    const fits = rooms.map((room) => roomInChars(theme, 'hud', room));
    expect(CHAPTER_TITLE_MAX_CHARS).toBe(Math.min(...fits));
  });
});
