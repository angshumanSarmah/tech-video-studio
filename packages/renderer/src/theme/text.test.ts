import { describe, expect, it } from 'vitest';
import { getTheme } from './registry.ts';
import { ThemeSchema } from './schema.ts';
import { bundledFonts, fontStack } from './text.ts';
import { blueprintDark } from './themes/blueprint-dark.ts';

describe('fontStack', () => {
  const theme = getTheme('blueprint-dark');

  it('puts bundled fallbacks between the family and the system fallback', () => {
    expect(fontStack(theme, 'display')).toBe(
      `'Barlow Condensed', 'Inter', ${theme.fonts.display.fallback}`,
    );
  });

  it('is the family plus the system fallback without bundled fallbacks', () => {
    expect(fontStack(theme, 'sans')).toBe(`'Inter', ${theme.fonts.sans.fallback}`);
  });

  it('resolves a glyphFallback face in the stack', () => {
    const paper = getTheme('drafting-paper');
    expect(fontStack(paper, 'mono')).toBe(`'IBM Plex Mono', 'Inter', ${paper.fonts.mono.fallback}`);
  });

  it('rejects a glyphFallback reference without a glyphFallback face', () => {
    const fonts = {
      ...blueprintDark.fonts,
      mono: { ...blueprintDark.fonts.mono, bundledFallbacks: ['glyphFallback' as const] },
    };
    const result = ThemeSchema.safeParse({ ...blueprintDark, fonts });
    expect(result.error?.issues[0]?.path).toEqual(['fonts', 'mono', 'bundledFallbacks']);
  });

  it('rejects a role that falls back to itself', () => {
    const fonts = {
      ...blueprintDark.fonts,
      sans: { ...blueprintDark.fonts.sans, bundledFallbacks: ['sans' as const] },
    };
    const result = ThemeSchema.safeParse({ ...blueprintDark, fonts });
    expect(result.error?.issues[0]?.path).toEqual(['fonts', 'sans', 'bundledFallbacks']);
  });
});

describe('bundledFonts', () => {
  it('lists the roles, then glyphFallback when the theme has one', () => {
    expect(bundledFonts(getTheme('blueprint-dark')).map((f) => f.key)).toEqual([
      'display',
      'mono',
      'sans',
    ]);
    const paper = bundledFonts(getTheme('drafting-paper'));
    expect(paper.map((f) => `${f.key}:${f.family}`)).toEqual([
      'display:IBM Plex Sans Condensed',
      'mono:IBM Plex Mono',
      'sans:IBM Plex Sans',
      'glyphFallback:Inter',
    ]);
  });
});
