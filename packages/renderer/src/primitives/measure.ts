import { textWidth } from '../fonts/measure-text.ts';
import type { TextStyleName, Theme } from '../theme/index.ts';

/**
 * Text width for size hints: the real glyph advances (`textWidth`: the style's case transform,
 * its font stack, letter spacing), rounded up. An average advance per character overstated
 * mixed text by up to a half at display sizes ("about 1.3" in the metric style: 597 px vs 411 px
 * drawn), so boards shrank for text that was never that wide.
 */
export function approxTextWidth(theme: Theme, style: TextStyleName, text: string): number {
  return Math.ceil(textWidth(theme, style, text));
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
