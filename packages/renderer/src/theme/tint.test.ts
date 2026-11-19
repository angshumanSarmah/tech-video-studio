import { describe, expect, it } from 'vitest';
import { getTheme } from './registry.ts';
import { checkAccentContrast, resolveAccent, semanticTint, tintFor } from './tint.ts';

const theme = getTheme('blueprint-dark');

describe('tintFor', () => {
  it('derives soft fill, border and glow from any hex using the theme rules', () => {
    const tint = tintFor(theme, '#b07cff');
    expect(tint.base).toBe('#b07cff');
    expect(tint.soft).toBe(`rgb(176 124 255 / ${theme.tint.softAlpha})`);
    expect(tint.border).toBe(`rgb(176 124 255 / ${theme.tint.borderAlpha})`);
    expect(tint.glowShadow).toContain(`0 0 ${theme.glow.outerBlur}px`);
    expect(tint.glowFilter).toMatch(/^drop-shadow\(.+\) drop-shadow\(.+\)$/);
  });
});

describe('resolveAccent', () => {
  it('keeps a valid accent and falls back for missing or invalid ones', () => {
    expect(resolveAccent(theme, '#B07CFF')).toBe('#B07CFF');
    for (const bad of [undefined, null, '', 'purple', '#abc']) {
      expect(resolveAccent(theme, bad)).toBe(theme.colours.fallbackAccent);
    }
  });
});

describe('checkAccentContrast', () => {
  it('passes the seeded series accents and flags a dark accent', () => {
    expect(checkAccentContrast(theme, '#4F8CFF').ok).toBe(true);
    expect(checkAccentContrast(theme, '#B07CFF').ok).toBe(true);
    const dark = checkAccentContrast(theme, '#1d3160');
    expect(dark).toMatchObject({ ok: false, minimum: theme.minimumContrast.text });
    expect(dark.ratio).toBeLessThan(dark.minimum);
  });
});

describe('semanticTint', () => {
  it('fills with the semantic colour itself when the theme has no override', () => {
    expect(semanticTint(theme, 'focus')).toEqual(tintFor(theme, theme.colours.semantic.focus));
  });

  it('keeps base, border and glow but swaps the soft fill for an override', () => {
    const paper = getTheme('drafting-paper');
    const tint = semanticTint(paper, 'focus');
    const plain = tintFor(paper, paper.colours.semantic.focus);
    expect(tint).toEqual({ ...plain, soft: 'rgb(255 216 77 / 0.55)' });
    expect(semanticTint(paper, 'ok')).toEqual(tintFor(paper, paper.colours.semantic.ok));
  });
});
