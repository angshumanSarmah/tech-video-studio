import { normalizeWord, type TimedWord } from '@explainer-studio/shared';

/** Helpers for the temporary `DevSubtitles` layer; deleted with it in P1B.3. */

/** Narration tokens as written, one per `narrationWords()` word ("Redis," stays "Redis,"). */
export function displayWords(narration: string): string[] {
  return narration.split(/\s+/).filter((token) => normalizeWord(token).length > 0);
}

/** Index of the word being spoken at `sec`: the last that has started, or -1 before the first. */
export function activeWordIndex(words: readonly TimedWord[], sec: number): number {
  return words.findLastIndex((w) => w.startSec <= sec);
}
