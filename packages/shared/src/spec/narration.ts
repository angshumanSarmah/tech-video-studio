/**
 * The single definition of a narration "word". Word-index anchors, word-text anchors and timing
 * word lists all count words this way; TTS output must be mapped back onto it (P1B.1/P1B.2).
 */

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Lowercases a token and strips leading/trailing punctuation ("Redis," -> "redis"). */
export function normalizeWord(token: string): string {
  return token.toLowerCase().replace(EDGE_PUNCTUATION, '');
}

/** Whitespace-separated tokens, normalized; tokens that are only punctuation are not words. */
export function narrationWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((word) => word.length > 0);
}

/** 0-based index of the n-th (1-based) occurrence of `word`, or undefined. */
export function findWordOccurrence(
  words: readonly string[],
  word: string,
  occurrence: number,
): number | undefined {
  const target = normalizeWord(word);
  let seen = 0;
  for (const [index, candidate] of words.entries()) {
    if (candidate === target && ++seen === occurrence) return index;
  }
  return undefined;
}
