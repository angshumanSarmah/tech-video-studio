import { isIdentifierAt, normalizeNumber } from '../research/numbers.ts';

/**
 * Numbers a text states, as values: digits ("10,000", "2.1", "10k", "2 million") and numbers
 * spoken in words ("ten thousand", "two point one", "twenty-four", "a hundred", years and status
 * codes read in pairs: "twenty twenty-five", "four twenty-nine"). The Scriptwriter's narration
 * says numbers as words for text-to-speech, so its numbers are compared with research values by
 * value, not as written. Identifiers are skipped as in the Researcher's checks (`p99` and
 * "p ninety-nine", `HTTP 429` and "HTTP four twenty-nine"). Ordinals ("fourteenth") are not read.
 */

export interface NumberMention {
  /** The mention as written, e.g. "ten thousand" or "10k". */
  readonly text: string;
  readonly value: number;
  /** Start of the mention in the text. */
  readonly index: number;
  /** A lone "one", "two" or "three": everyday words more often than counts. */
  readonly everyday: boolean;
}

const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const TEENS: Readonly<Record<string, number>> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  dozen: 12,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Readonly<Record<string, number>> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};
/** Letters glued to digits that scale them: "10k", "2M", "1B". */
const GLUED_SCALES: Readonly<Record<string, number>> = { k: 1e3, K: 1e3, M: 1e6, B: 1e9 };

const EVERYDAY = new Set(['one', 'two', 'three']);
/** Words that start a status code ("HTTP four twenty-nine"). */
const STATUS_LEADS = new Set(['http', 'status', 'error']);
/** Single letters that are words, so a number after them is not an identifier ("a forty"). */
const LETTER_WORDS = new Set(['a', 'i']);

type Kind = 'unit' | 'teen' | 'tens' | 'hundred' | 'scale' | 'and';

function kindOf(word: string | undefined): Kind | undefined {
  if (word === undefined) return undefined;
  if (word in UNITS) return 'unit';
  if (word in TEENS) return 'teen';
  if (word in TENS) return 'tens';
  if (word === 'hundred') return 'hundred';
  if (word in SCALES) return 'scale';
  if (word === 'and') return 'and';
  return undefined;
}

function wordValue(word: string): number {
  return UNITS[word] ?? TEENS[word] ?? TENS[word] ?? 0;
}

/** Which word may follow which in a cardinal ("two hundred and five thousand"). */
const NEXT: Readonly<Record<Kind | 'start', readonly Kind[]>> = {
  start: ['unit', 'teen', 'tens', 'hundred', 'scale'],
  unit: ['hundred', 'scale'],
  teen: ['hundred', 'scale'],
  tens: ['unit', 'scale'],
  hundred: ['and', 'unit', 'teen', 'tens', 'scale'],
  scale: ['and', 'unit', 'teen', 'tens'],
  and: ['unit', 'teen', 'tens'],
};

const isDigitWord = (word: string | undefined) => word === 'oh' || kindOf(word) === 'unit';
const digitOf = (word: string) => (word === 'oh' ? 0 : wordValue(word));

interface Parsed {
  readonly value: number;
  readonly next: number;
  /** A plain 1-99 (no hundred, scale or decimal): may start a pair ("twenty twenty-five"). */
  readonly simple: boolean;
}

/** The longest cardinal starting at `i`, or undefined. */
function cardinal(words: readonly string[], i: number): Parsed | undefined {
  let total = 0;
  let current = 0;
  let simple = true;
  let last: Kind | 'start' = 'start';
  let j = i;
  if (words[j] === 'a' && ['hundred', 'scale'].includes(kindOf(words[j + 1]) ?? '')) {
    current = 1;
    last = 'unit';
    j += 1;
  }
  for (; j < words.length; j += 1) {
    const word = words[j]!;
    const kind = kindOf(word);
    if (!kind || !NEXT[last].includes(kind)) break;
    if (kind === 'and' && !NEXT.and.includes(kindOf(words[j + 1]) ?? 'and')) break;
    if (kind === 'hundred') current = (current || 1) * 100;
    else if (kind === 'scale') {
      total += (current || 1) * SCALES[word]!;
      current = 0;
    } else current += wordValue(word);
    if (kind === 'hundred' || kind === 'scale') simple = false;
    last = kind;
  }
  if (j === i || last === 'start') return undefined;
  return { value: total + current, next: j, simple };
}

/** "point four" after a whole number, or alone (".4"). */
function decimal(words: readonly string[], i: number, whole: number): Parsed | undefined {
  if (words[i] !== 'point' || !isDigitWord(words[i + 1])) return undefined;
  let digits = '';
  let j = i + 1;
  while (isDigitWord(words[j])) digits += String(digitOf(words[j++]!));
  return { value: Number(`${whole}.${digits}`), next: j, simple: false };
}

/** The second half of a pair: "twenty-five", "ninety", "oh three". */
function pairTail(words: readonly string[], i: number): Parsed | undefined {
  const kind = kindOf(words[i]);
  if (kind === 'teen') return { value: wordValue(words[i]!), next: i + 1, simple: false };
  if (kind === 'tens') {
    const unit = kindOf(words[i + 1]) === 'unit' && words[i + 1] !== 'zero';
    const value = wordValue(words[i]!) + (unit ? wordValue(words[i + 1]!) : 0);
    return { value, next: i + (unit ? 2 : 1), simple: false };
  }
  if (words[i] === 'oh' && kindOf(words[i + 1]) === 'unit') {
    return { value: wordValue(words[i + 1]!), next: i + 2, simple: false };
  }
  return undefined;
}

/** One number starting at `i` of a run of words: cardinal, then a decimal or a pair tail. */
function spokenNumber(words: readonly string[], i: number): Parsed | undefined {
  const leading = decimal(words, i, 0);
  if (leading) return leading;
  const whole = cardinal(words, i);
  if (!whole) return undefined;
  const fraction = decimal(words, whole.next, whole.value);
  if (fraction) return fraction;
  const tail = whole.simple && whole.value >= 1 ? pairTail(words, whole.next) : undefined;
  return tail ? { value: whole.value * 100 + tail.value, next: tail.next, simple: false } : whole;
}

interface Token {
  readonly text: string;
  readonly index: number;
  readonly end: number;
  readonly digits: boolean;
}

const TOKEN = /\d+(?:[.,]\d+)*|\p{L}+/gu;

function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(TOKEN), (m) => ({
    text: m[0],
    index: m.index,
    end: m.index + m[0].length,
    digits: /^\d/.test(m[0]),
  }));
}

/** Two tokens are one phrase when only spaces or hyphens separate them. */
function joined(text: string, a: Token | undefined, b: Token | undefined): boolean {
  return a !== undefined && b !== undefined && /^[\s-]*$/.test(text.slice(a.end, b.index));
}

function digitMention(text: string, tokens: readonly Token[], i: number) {
  const token = tokens[i]!;
  const next = tokens[i + 1];
  const glued = next !== undefined && !next.digits && next.index === token.end;
  const gluedScale = glued ? GLUED_SCALES[next.text] : undefined;
  const wordScale =
    next && !glued && joined(text, token, next) ? SCALES[next.text.toLowerCase()] : undefined;
  const scale = gluedScale ?? wordScale;
  const end = scale ? next!.end : token.end;
  const mention: NumberMention = {
    text: text.slice(token.index, end),
    value: Number(normalizeNumber(token.text)) * (scale ?? 1),
    index: token.index,
    everyday: false,
  };
  return { mention, next: scale ? i + 2 : i + 1 };
}

/** A spoken number right after a lone letter ("p ninety-nine") or a status lead names a thing. */
function spokenIdentifier(text: string, before: Token | undefined, first: Token, value: number) {
  if (!before || before.digits || !joined(text, before, first)) return false;
  const word = before.text.toLowerCase();
  if (word.length === 1 && !LETTER_WORDS.has(word)) return true;
  return STATUS_LEADS.has(word) && Number.isInteger(value) && value >= 100 && value <= 599;
}

const isRunWord = (word: string) =>
  kindOf(word) !== undefined || word === 'point' || word === 'oh' || word === 'a';

/** Consecutive word tokens that may belong to spoken numbers, from `i`. */
function runEnd(text: string, tokens: readonly Token[], i: number): number {
  let j = i;
  while (
    j < tokens.length &&
    !tokens[j]!.digits &&
    isRunWord(tokens[j]!.text.toLowerCase()) &&
    (j === i || joined(text, tokens[j - 1], tokens[j]))
  ) {
    j += 1;
  }
  return j;
}

function spokenMentions(text: string, tokens: readonly Token[], from: number, to: number) {
  const words = tokens.slice(from, to).map((t) => t.text.toLowerCase());
  const mentions: NumberMention[] = [];
  for (let k = 0; k < words.length;) {
    const parsed = spokenNumber(words, k);
    if (!parsed) {
      k += 1;
      continue;
    }
    const first = tokens[from + k]!;
    const last = tokens[from + parsed.next - 1]!;
    if (!spokenIdentifier(text, tokens[from + k - 1], first, parsed.value)) {
      mentions.push({
        text: text.slice(first.index, last.end),
        value: parsed.value,
        index: first.index,
        everyday: parsed.next - k === 1 && EVERYDAY.has(words[k]!),
      });
    }
    k = parsed.next;
  }
  return mentions;
}

/** Every number the text states, in order (identifiers skipped). Pure. */
export function numberMentions(text: string): NumberMention[] {
  const tokens = tokenize(text);
  const mentions: NumberMention[] = [];
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]!;
    if (token.digits) {
      if (isIdentifierAt(text, token.index, token.text)) {
        i += 1;
        continue;
      }
      const { mention, next } = digitMention(text, tokens, i);
      mentions.push(mention);
      i = next;
      continue;
    }
    const end = runEnd(text, tokens, i);
    if (end === i) {
      i += 1;
      continue;
    }
    mentions.push(...spokenMentions(text, tokens, i, end));
    i = end;
  }
  return mentions;
}

/** A stable key for comparing values ("0.4" and "zero point four" give the same key). */
export function numberKey(value: number): string {
  return String(Number(value.toPrecision(12)));
}
