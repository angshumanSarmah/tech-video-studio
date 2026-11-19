import { describe, expect, it } from 'vitest';
import { getTheme } from '../theme/index.ts';
import { approxTextWidth, widestWord, wrappedRows } from './measure.ts';

describe('approxTextWidth', () => {
  it("uses the role's advanceEm plus the style's letter spacing", () => {
    const theme = getTheme('blueprint-dark');
    const { size, letterSpacing } = theme.text.title;
    const expected = Math.ceil(4 * size * (theme.fonts.display.advanceEm + letterSpacing));
    expect(approxTextWidth(theme, 'title', 'GATE')).toBe(expected);
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
