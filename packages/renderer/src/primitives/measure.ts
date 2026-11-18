import type { FontRole, TextStyleName, Theme } from '../theme/index.ts';

/**
 * Rough text extents for size hints, in em per character by font role. Good enough for hints;
 * the layout engine (P1A.9) can measure real glyphs if hints prove too loose.
 */
const ADVANCE_EM: Record<FontRole, number> = { mono: 0.6, display: 0.5, sans: 0.55 };

export function approxTextWidth(theme: Theme, style: TextStyleName, text: string): number {
  const { size, font, letterSpacing } = theme.text[style];
  return Math.ceil([...text].length * size * (ADVANCE_EM[font] + letterSpacing));
}

export function lineHeightPx(theme: Theme, style: TextStyleName): number {
  const { size, lineHeight } = theme.text[style];
  return Math.ceil(size * lineHeight);
}
