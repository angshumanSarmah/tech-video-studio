import type { TextStyleName, Theme } from '../theme/index.ts';

/**
 * Rough text extents for size hints, from the font role's `advanceEm` (em per character). Good
 * enough for hints; the layout engine (P1A.9) can measure real glyphs if hints prove too loose.
 */
export function approxTextWidth(theme: Theme, style: TextStyleName, text: string): number {
  const { size, font, letterSpacing } = theme.text[style];
  const { advanceEm } = theme.fonts[font];
  return Math.ceil([...text].length * size * (advanceEm + letterSpacing));
}

export function lineHeightPx(theme: Theme, style: TextStyleName): number {
  const { size, lineHeight } = theme.text[style];
  return Math.ceil(size * lineHeight);
}
