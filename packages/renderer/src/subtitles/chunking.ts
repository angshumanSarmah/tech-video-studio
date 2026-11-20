import { normalizeWord } from '@explainer-studio/shared';

/**
 * Splitting one beat's timed words into subtitle cue chunks: at pauses, then after punctuation,
 * then by size and readability. Pure; `fits` says whether a line fits the subtitle band.
 */

export type TimedToken = { text: string; startSec: number; endSec: number };

/** A silence longer than this between two words always ends a cue. */
export const PAUSE_BREAK_SEC = 0.25;

/** Float slack for comparing word gaps with `PAUSE_BREAK_SEC` (timings are sums of floats). */
const GAP_EPSILON_SEC = 1e-6;

/** Most words in one cue. */
export const MAX_CUE_WORDS = 4;

/** Punctuation that closes a phrase: a sentence or a clause. */
const PHRASE_END = /[.!?,;:…—–]["'”’)\]]*$/u;

/**
 * Words that lean on the word after them: a chunk should not end on one ("each client a /
 * bucket of tokens"). Articles, prepositions, conjunctions and possessive determiners.
 */
const LEANING_WORDS = new Set(
  (
    'a an the of to in on at for with by from into onto over under about than per via and or ' +
    'but nor so if as my your our its their his her this these those'
  ).split(' '),
);

/** A number word before one of these is part of the same number ("ten / thousand" is a bad cut). */
const MAGNITUDES = new Set(['hundred', 'thousand', 'million', 'billion', 'trillion']);

/** Chunk cost weights: fewer chunks, no lone words, no leaning ends, about `IDEAL_WORDS` each. */
const COST = { chunk: 10, lone: 20, leaningEnd: 12 } as const;
const IDEAL_WORDS = 3;

/** Splits one beat's tokens into cue chunks (pauses, then punctuation, then size). */
export function chunkTokens<T extends TimedToken>(
  tokens: readonly T[],
  fits: (line: string) => boolean,
): T[][] {
  const segments = splitAfter(
    tokens,
    (t, next) => next.startSec - t.endSec > PAUSE_BREAK_SEC + GAP_EPSILON_SEC,
  );
  return segments.flatMap((segment) => {
    const phrases = splitAfter(segment, (t) => PHRASE_END.test(t.text));
    return joinLoneWords(phrases, fits).flatMap((phrase) => bestChunks(phrase, fits));
  });
}

export function lineText(tokens: readonly TimedToken[]): string {
  return tokens.map((t) => t.text).join(' ');
}

/** Splits `items` after every item for which `breaksAfter(item, next)` holds. */
function splitAfter<T>(items: readonly T[], breaksAfter: (item: T, next: T) => boolean): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  items.forEach((item, i) => {
    current.push(item);
    const next = items[i + 1];
    if (next === undefined || breaksAfter(item, next)) {
      groups.push(current);
      current = [];
    }
  });
  return groups;
}

/**
 * A one-word phrase ("So," "Then,") joins the phrase after it, else the one before it, when the
 * result stays within `MAX_CUE_WORDS` and fits; otherwise it stays a cue of its own.
 */
function joinLoneWords<T extends TimedToken>(
  phrases: readonly T[][],
  fits: (line: string) => boolean,
): T[][] {
  const canJoin = (words: readonly T[]) => words.length <= MAX_CUE_WORDS && fits(lineText(words));
  const result: T[][] = [];
  let carry: T[] = [];
  for (const [i, phrase] of phrases.entries()) {
    const words = [...carry, ...phrase];
    carry = [];
    const next = phrases[i + 1];
    const previous = result.at(-1);
    if (words.length === 1 && next && canJoin([...words, ...next])) {
      carry = words;
    } else if (words.length === 1 && previous && canJoin([...previous, ...words])) {
      result[result.length - 1] = [...previous, ...words];
    } else {
      result.push(words);
    }
  }
  return result;
}

/**
 * The cheapest split of a phrase into chunks of 1 to `MAX_CUE_WORDS` words that each fit a line
 * (a word that fits nowhere is a chunk of its own): `COST` per chunk, per lone word and per
 * chunk ending on a leaning word, plus the squared distance of each size from `IDEAL_WORDS`.
 * Ties keep the longer first chunk. Dynamic programming from the phrase's end.
 */
function bestChunks<T extends TimedToken>(
  phrase: readonly T[],
  fits: (line: string) => boolean,
): T[][] {
  const n = phrase.length;
  const best: { cost: number; size: number }[] = Array.from({ length: n + 1 }, () => ({
    cost: Infinity,
    size: 0,
  }));
  best[n] = { cost: 0, size: 0 };
  for (let from = n - 1; from >= 0; from--) {
    for (let size = Math.min(MAX_CUE_WORDS, n - from); size >= 1; size--) {
      const chunk = phrase.slice(from, from + size);
      if (size > 1 && !fits(lineText(chunk))) continue;
      const cost = chunkCost(chunk, phrase[from + size], n) + best[from + size]!.cost;
      if (cost < best[from]!.cost) best[from] = { cost, size };
    }
  }
  const chunks: T[][] = [];
  for (let from = 0; from < n; from += best[from]!.size) {
    chunks.push(phrase.slice(from, from + best[from]!.size));
  }
  return chunks;
}

function chunkCost(chunk: readonly TimedToken[], next: TimedToken | undefined, n: number): number {
  const last = chunk.at(-1);
  const lone = chunk.length === 1 && n > 1;
  const leaning = next !== undefined && last !== undefined && leansOn(last, next);
  return (
    COST.chunk +
    (lone ? COST.lone : 0) +
    (leaning ? COST.leaningEnd : 0) +
    (chunk.length - IDEAL_WORDS) ** 2
  );
}

/** Whether `word` should stay on the same line as `next`. */
function leansOn(word: TimedToken, next: TimedToken): boolean {
  if (PHRASE_END.test(word.text)) return false;
  return LEANING_WORDS.has(normalizeWord(word.text)) || MAGNITUDES.has(normalizeWord(next.text));
}
