import { describe, expect, it } from 'vitest';
import { mutedText } from '../primitives/muted-text.ts';
import {
  DIM_FADE,
  DIMMED_MUTED_MIN_CONTRAST,
  DIMMED_TEXT_MIN_CONTRAST,
  dimOpacity,
  FOCUS_DIM_FADE,
  FOCUS_DIM_LEVEL,
} from '../events/presets.ts';
import { blendOver, contrastRatio } from './colour.ts';
import { listThemes } from './index.ts';

/**
 * Out-of-focus labels stay readable on a phone (run 1: neutral labels at the old 0.7 dim gave
 * 1.86:1 on paper). The text colour drawn at the out-of-focus opacity over the background keeps
 * `DIMMED_TEXT_MIN_CONTRAST`, in every theme.
 */
describe('dimmed text contrast', () => {
  it('focus dims lighter than an explicit dim, through the same level', () => {
    expect(FOCUS_DIM_FADE).toBeLessThan(DIM_FADE);
    expect(dimOpacity(FOCUS_DIM_LEVEL)).toBeCloseTo(1 - FOCUS_DIM_FADE, 10);
  });

  for (const theme of listThemes()) {
    it(`${theme.id}: neutral and primary ink text keep ${DIMMED_TEXT_MIN_CONTRAST}:1 out of focus`, () => {
      const bg = theme.colours.background;
      for (const colour of [theme.colours.semantic.neutral, theme.colours.ink.primary]) {
        const dimmed = blendOver(colour, dimOpacity(FOCUS_DIM_LEVEL), bg);
        expect(contrastRatio(dimmed, bg)).toBeGreaterThanOrEqual(DIMMED_TEXT_MIN_CONTRAST);
      }
    });
  }

  for (const theme of listThemes()) {
    it(`${theme.id}: muted text keeps ${DIMMED_MUTED_MIN_CONTRAST}:1 out of focus, shifting toward ink only as needed`, () => {
      const bg = theme.colours.background;
      const opacity = dimOpacity(FOCUS_DIM_LEVEL);
      const muted = mutedText(theme, FOCUS_DIM_LEVEL);
      expect(contrastRatio(blendOver(muted, opacity, bg), bg)).toBeGreaterThanOrEqual(
        DIMMED_MUTED_MIN_CONTRAST,
      );
      // Undimmed, muted text is the theme's own.
      expect(mutedText(theme, 0)).toBe(theme.colours.ink.muted);
    });
  }
});
