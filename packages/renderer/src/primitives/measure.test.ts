import { describe, expect, it } from 'vitest';
import { textWidth } from '../fonts/measure-text.ts';
import { getTheme } from '../theme/index.ts';
import { approxTextWidth, widestWord, wrappedRows } from './measure.ts';

describe('approxTextWidth', () => {
  it('measures real glyph advances (rounded up), not an average per character', () => {
    for (const theme of [getTheme('blueprint-dark'), getTheme()]) {
      for (const [style, text] of [
        ['title', 'GATE'],
        ['metric', 'about 1.3'],
        ['label', 'tokens per English word'],
      ] as const) {
        expect(approxTextWidth(theme, style, text)).toBe(Math.ceil(textWidth(theme, style, text)));
      }
    }
    // Narrow glyphs and spaces count as drawn: far less than the average advance gives.
    const theme = getTheme();
    const { size, font } = theme.text.metric;
    const average = 9 * size * theme.fonts[font].advanceEm;
    expect(approxTextWidth(theme, 'metric', 'about 1.3')).toBeLessThan(average * 0.75);
  });

  it('gives display text about the same width in both themes (sizes scaled by advance)', () => {
    const dark = approxTextWidth(getTheme('blueprint-dark'), 'title', 'API GATEWAY');
    const paper = approxTextWidth(getTheme('drafting-paper'), 'title', 'API GATEWAY');
    expect(Math.abs(paper - dark) / dark).toBeLessThan(0.03);
  });
});

describe('wrappedRows', () => {
  const theme = getTheme();
  const text = 'HARD: PICK THE RIGHT ONE.';

  it('keeps text on one row when it fits', () => {
    expect(wrappedRows(theme, 'headline', text, approxTextWidth(theme, 'headline', text))).toBe(1);
  });

  it('breaks at word boundaries, never inside a word', () => {
    const width = approxTextWidth(theme, 'headline', 'HARD: PICK THE');
    expect(wrappedRows(theme, 'headline', text, width)).toBe(2);
    expect(wrappedRows(theme, 'headline', text, widestWord(theme, 'headline', text))).toBe(5);
  });

  it('gives an over-long word a row of its own', () => {
    expect(wrappedRows(theme, 'headline', 'A SUPERCALIFRAGILISTIC B', 100)).toBe(3);
  });
});
