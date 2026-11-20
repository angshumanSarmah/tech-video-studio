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
function isGluedIdentifier(text: string, index: number): boolean {
  const prev = text[index - 1];
  if (isLetter(prev)) return true;
  if ((prev === '-' || prev === '/') && isLetter(text[index - 2])) return true;
  return prev === '(' && ORDER_OF.test(text[index - 2] ?? '') && !isLetter(text[index - 3]);
}

/** An HTTP status code (100-599). */
const STATUS_CODE = /^[1-5]\d\d$/;
/** The word right before a status code: "HTTP 429", "status 503", "error 500". */
const STATUS_LEAD = /(?:^|[^\p{L}])(?:http|status|error)\s+$/iu;

/** A status code after "HTTP", "status" or "error" names a response, it does not measure one. */
function isStatusCode(text: string, index: number, token: string): boolean {
  return STATUS_CODE.test(token) && STATUS_LEAD.test(text.slice(Math.max(0, index - 16), index));
}

function isIdentifierAt(text: string, index: number, token: string): boolean {
  return isGluedIdentifier(text, index) || isStatusCode(text, index, token);
}

export function normalizeNumber(token: string): string {
  return token.replaceAll(',', '');
}

/** Quantities in a text (identifiers skipped), as written. */
export function quantityTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(NUMBER)) {
    if (!isIdentifierAt(text, match.index, match[0])) tokens.push(match[0]);
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

/**
 * Cardinal number words. Vague plurals ("hundreds of") are not counts. "one", "two" and "three"
 * are listed but allowed (`EVERYDAY_NUMBER_WORDS`): they read as everyday words ("one shared
 * store", "two tills") more often than as quantities.
 */
const NUMBER_WORDS = new Set([
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'million',
  'billion',
  'trillion',
  'dozen',
]);

/** Number words texts without a source may still use, alone ("two tills", not "twenty-two"). */
export const EVERYDAY_NUMBER_WORDS: ReadonlySet<string> = new Set(['one', 'two', 'three']);

const WORD = /\p{L}+(?:-\p{L}+)*/gu;

/**
 * Numbers written as words ("Twenty-four", "ten"), as written, for texts that carry none. A word
 * counts when any hyphenated part is a number word other than the everyday ones, so "two" and
 * "three" pass while "twenty-two" and "three-hundred" do not.
 */
export function numberWordTokens(text: string): string[] {
  return Array.from(text.matchAll(WORD), (m) => m[0]).filter((word) =>
    word
      .toLowerCase()
      .split('-')
      .some((part) => NUMBER_WORDS.has(part) && !EVERYDAY_NUMBER_WORDS.has(part)),
  );
}
