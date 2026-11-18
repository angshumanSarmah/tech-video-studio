/**
 * Rough extent of a rendered formula in em, for size hints only. KaTeX lays out in a browser, so
 * the worker cannot measure it; the layout engine (P1A.9) may measure the DOM if this proves too
 * loose. A tiny reader over the LaTeX: a fraction is as wide as its wider part, scripts are
 * smaller, structural commands draw nothing themselves.
 */

/** Commands that draw nothing by themselves (fonts, styles, spacing); their group still counts. */
const SILENT_COMMANDS = new Set([
  'left',
  'right',
  'mathrm',
  'mathbf',
  'mathit',
  'mathsf',
  'text',
  'textrm',
  'textbf',
  'operatorname',
  'displaystyle',
]);
const FRACTIONS = new Set(['frac', 'dfrac', 'tfrac']);
/** Spacing commands, in em. */
const SPACES: Record<string, number> = { quad: 1, qquad: 2, ',': 0.17, ';': 0.28, ' ': 0.25 };

const GLYPH_EM = 0.6;
const SPACE_EM = 0.25;
const SCRIPT_SCALE = 0.7;
const SQRT_EM = 1;
const LINE_EM = 1.4;
/** Height of a formula with a fraction: numerator over denominator. */
const FRACTION_EM = 3;

export type LatexExtent = { widthEm: number; heightEm: number };

export function estimateLatexExtent(latex: string): LatexExtent {
  const reader = { text: latex, at: 0 };
  const widthEm = Math.max(GLYPH_EM, readSequence(reader, false));
  const hasFraction = /\\[dt]?frac\b/.test(latex);
  return { widthEm, heightEm: hasFraction ? FRACTION_EM : LINE_EM };
}

type Reader = { text: string; at: number };

/** Width of tokens up to the end, or up to the closing brace when `inGroup`. */
function readSequence(r: Reader, inGroup: boolean): number {
  let width = 0;
  while (r.at < r.text.length) {
    if (r.text[r.at] === '}') {
      r.at += 1;
      if (inGroup) return width;
      continue;
    }
    width += readToken(r);
  }
  return width;
}

function readToken(r: Reader): number {
  const ch = r.text[r.at] ?? '';
  r.at += 1;
  if (ch === '{') return readSequence(r, true);
  if (ch === '^' || ch === '_') return readToken(r) * SCRIPT_SCALE;
  if (/\s/.test(ch)) return SPACE_EM;
  if (ch === '\\') return readCommand(r);
  return GLYPH_EM;
}

function readCommand(r: Reader): number {
  const name = /^([A-Za-z]+|.)/.exec(r.text.slice(r.at))?.[1] ?? '';
  r.at += name.length;
  if (FRACTIONS.has(name)) return Math.max(readToken(r), readToken(r)) + GLYPH_EM / 2;
  if (name === 'sqrt') return readToken(r) + SQRT_EM;
  const space = SPACES[name];
  if (space !== undefined) return space;
  return SILENT_COMMANDS.has(name) ? 0 : GLYPH_EM;
}
