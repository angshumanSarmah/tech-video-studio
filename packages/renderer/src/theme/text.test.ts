import { describe, expect, it } from 'vitest';
import { getTheme } from './registry.ts';
import { ThemeSchema } from './schema.ts';
import { fontStack } from './text.ts';
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

  it('rejects a role that falls back to itself', () => {
    const fonts = {
      ...blueprintDark.fonts,
      sans: { ...blueprintDark.fonts.sans, bundledFallbacks: ['sans' as const] },
    };
    const result = ThemeSchema.safeParse({ ...blueprintDark, fonts });
    expect(result.error?.issues[0]?.path).toEqual(['fonts', 'sans', 'bundledFallbacks']);
  });
});
