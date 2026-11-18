/**
 * Glyphs the bundled fonts must cover. React-free: the subset script and the coverage test share
 * these lists. A role's text may use any required glyph, so every role's bundled stack (its own
 * files plus its `bundledFallbacks`) must cover all of them.
 */

type CodePointRange = readonly [from: number, to: number];

function expand(ranges: readonly CodePointRange[]): number[] {
  return ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i));
}

function codePoints(chars: string): number[] {
  return [...chars].map((c) => c.codePointAt(0) ?? 0);
}

/** Symbols HUD and primitive text may use (arrows, comparisons, check marks, rupee, ellipsis). */
export const REQUIRED_SYMBOLS = '←→↑↓·×✓✗≈≤≥₹…';

/** Dashes and curly quotes, e.g. the chapter header's "— 2 · …". */
const PUNCTUATION = '–—‘’“”';

/**
 * Not required: U+00AD (soft hyphen) is an invisible format character browsers never draw, and
 * U+0149 (ŉ) is deprecated by Unicode and missing from Inter.
 */
const NOT_REQUIRED = new Set([0xad, 0x149]);

/** Basic Latin, Latin-1 Supplement and Latin Extended-A, plus the symbols above. */
export const REQUIRED_CODE_POINTS: readonly number[] = [
  ...expand([
    [0x20, 0x7e],
    [0xa0, 0xff],
    [0x100, 0x17f],
  ]).filter((cp) => !NOT_REQUIRED.has(cp)),
  ...codePoints(PUNCTUATION),
  ...codePoints(REQUIRED_SYMBOLS),
];

/**
 * What the subset script keeps from each source font, where present: the required glyphs plus
 * Latin Extended-B and Additional, general punctuation, currency signs, arrows and a few maths
 * operators. Source fonts cover these unevenly; only `REQUIRED_CODE_POINTS` is checked.
 */
export const SUBSET_CODE_POINTS: readonly number[] = [
  ...new Set([
    ...REQUIRED_CODE_POINTS,
    ...expand([
      [0x180, 0x24f],
      [0x1e00, 0x1eff],
      [0x2000, 0x206f],
      [0x20a0, 0x20cf],
      [0x2190, 0x2199],
      [0x2212, 0x2212],
      [0x221e, 0x221e],
      [0x2248, 0x2248],
      [0x2260, 0x2260],
      [0x2264, 0x2265],
    ]),
  ]),
].sort((a, b) => a - b);

/** `U+2192 (→)` style label for test and script output. */
export function describeCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')} (${String.fromCodePoint(cp)})`;
}
