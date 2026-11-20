/**
 * Numbers in prose, for the "no unsourced numbers" check. A number is a digit run with optional
 * `.`/`,` groups ("10,000", "1.5", "1,00,000"); grouping commas are dropped when comparing, so
 * "10,000" and "10000" match, but "10" never matches "100".
 */

const NUMBER = /\d+(?:[.,]\d+)*/g;
const LETTER = /\p{L}/u;
/** Big-O style notation: `O(1)`, `Θ(n)`. */
const ORDER_OF = /[OΘΩ]/;

function isLetter(char: string | undefined): boolean {
  return char !== undefined && LETTER.test(char);
}

/**
 * Digits glued to letters name things rather than measure them: `IPv4`, `L7`, `p99`, `SHA-256`,
 * `HTTP/2`, `UTF-8`, `O(1)`. Digits followed by letters stay quantities (`50ms`, `10k`, `5xx`).
 */
function isIdentifierAt(text: string, index: number): boolean {
  const prev = text[index - 1];
  if (isLetter(prev)) return true;
  if ((prev === '-' || prev === '/') && isLetter(text[index - 2])) return true;
  return prev === '(' && ORDER_OF.test(text[index - 2] ?? '') && !isLetter(text[index - 3]);
}

export function normalizeNumber(token: string): string {
  return token.replaceAll(',', '');
}

/** Quantities in a text (identifiers skipped), as written. */
export function quantityTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(NUMBER)) {
    if (!isIdentifierAt(text, match.index)) tokens.push(match[0]);
  }
  return tokens;
}

/** Every number in a text, identifiers included, normalized: what a source "states". */
export function numberSet(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(NUMBER), (m) => normalizeNumber(m[0])));
}

/** Lowercased with whitespace collapsed, for matching numbers written in words. */
export function foldText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
