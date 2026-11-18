import { describe, expect, it } from 'vitest';
import { getTheme } from './registry.ts';
import { checkAccentContrast, resolveAccent, tintFor } from './tint.ts';

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
