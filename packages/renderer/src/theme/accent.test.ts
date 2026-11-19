import { describe, expect, it } from 'vitest';
import { accentFor, seriesAccent } from './accent.ts';
import { contrastRatio, relativeLuminance } from './colour.ts';
import { getTheme } from './registry.ts';

const paper = getTheme('drafting-paper');
const dark = getTheme('blueprint-dark');
const SERIES = ['#4F8CFF', '#B07CFF'];

const ratio = (theme: typeof paper, hex: string) => contrastRatio(hex, theme.colours.background);

describe('accentFor', () => {
  it.each(SERIES)('adapts %s to pass the text minimum on drafting-paper', (stored) => {
    expect(ratio(paper, stored)).toBeLessThan(paper.minimumContrast.text);
    const adapted = accentFor(paper, stored);
    expect(adapted).not.toBe(stored);
    expect(ratio(paper, adapted)).toBeGreaterThanOrEqual(paper.minimumContrast.text);
    // Toward the ink: darker on a light background.
    expect(relativeLuminance(adapted)).toBeLessThan(relativeLuminance(stored));
  });

  it('moves only as far as needed (just over the minimum)', () => {
    for (const stored of SERIES) {
      expect(ratio(paper, accentFor(paper, stored))).toBeLessThan(paper.minimumContrast.text + 0.1);
    }
  });

  it('returns colours that already pass unchanged, as the same string', () => {
    for (const stored of SERIES) expect(accentFor(dark, stored)).toBe(stored);
    expect(accentFor(paper, paper.colours.fallbackAccent)).toBe(paper.colours.fallbackAccent);
    expect(accentFor(paper, '#1f2328')).toBe('#1f2328');
  });

  it('lightens toward the ink on a dark background', () => {
    const adapted = accentFor(dark, '#1F4FD1');
    expect(ratio(dark, adapted)).toBeGreaterThanOrEqual(dark.minimumContrast.text);
    expect(relativeLuminance(adapted)).toBeGreaterThan(relativeLuminance('#1F4FD1'));
  });

  it('is deterministic', () => {
    for (const stored of [...SERIES, '#FFD84D', '#3DDC97']) {
      expect(accentFor(paper, stored)).toBe(accentFor(paper, stored));
    }
    expect(accentFor(paper, '#4F8CFF')).toBe('#2e69d8');
  });
});

describe('seriesAccent', () => {
  it('resolves a missing or invalid accent to the fallback, then adapts', () => {
    expect(seriesAccent(paper, null)).toBe(paper.colours.fallbackAccent);
    expect(seriesAccent(paper, 'purple')).toBe(paper.colours.fallbackAccent);
    expect(seriesAccent(paper, '#4F8CFF')).toBe(accentFor(paper, '#4F8CFF'));
  });
});
