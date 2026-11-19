import { describe, expect, it } from 'vitest';
import { getTheme } from '../theme/index.ts';
import { approxTextWidth } from './measure.ts';

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
