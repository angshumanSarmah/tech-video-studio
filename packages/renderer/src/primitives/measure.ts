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

/**
 * Rows `text` takes when it wraps at word boundaries within `width` px (greedy, like CSS). A word
 * wider than the row gets a row of its own. At least 1.
 */
export function wrappedRows(
  theme: Theme,
  style: TextStyleName,
  text: string,
  width: number,
): number {
  let rows = 1;
  let row = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && approxTextWidth(theme, style, candidate) > width) {
      rows += 1;
      row = word;
    } else {
      row = candidate;
    }
  }
  return rows;
}

/** Width of the widest single word: text never wraps narrower than this. */
export function widestWord(theme: Theme, style: TextStyleName, text: string): number {
  return Math.max(0, ...text.split(/\s+/).map((word) => approxTextWidth(theme, style, word)));
}
