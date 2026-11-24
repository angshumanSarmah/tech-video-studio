import { narrationSentences, narrationWords } from '../spec/narration.ts';

/**
 * Flesch reading ease for narration (P1C.8): `206.835 − 1.015 × words per sentence − 84.6 ×
 * syllables per word`. Higher reads easier; plain conversational English scores 60–80. Words and
 * sentences are counted as the rest of the pipeline counts them (`narrationWords`,
 * `narrationSentences`); syllables with a vowel-group heuristic (English only, about ±1 per long
 * word, good enough to rank beats). Spoken numbers count like any word. Pure.
 */

/** Silent endings dropped before counting vowel groups ("make", "used", "boxes" keep theirs). */
const SILENT_ENDING = /(?:[^laeiouy]es|ed|[^laeiouy]e)$/;

/** Vowel groups count one syllable each; a leading "y" is a consonant. */
const VOWEL_GROUP = /[aeiouy]{1,2}/g;

/** Syllables of one word (letters only; a word with none counts as one). */
export function syllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length === 0) return 0;
  if (letters.length <= 3) return 1;
  const trimmed = letters.replace(SILENT_ENDING, '').replace(/^y/, '');
  return Math.max(1, trimmed.match(VOWEL_GROUP)?.length ?? 0);
}

/** Words of a narration as heard: a hyphenated word counts as its parts ("twenty-four" is two). */
function spokenWords(text: string): string[] {
  return narrationWords(text).flatMap((w) => w.split('-').filter((p) => /[a-z]/i.test(p)));
}

export type Readability = {
  /** Flesch reading ease, rounded to one decimal. */
  score: number;
  words: number;
  sentences: number;
  /** Words of three syllables or more, in order, each once. */
  longWords: string[];
};

/** Reading ease of a narration; `undefined` when it has no words. */
export function readability(text: string): Readability | undefined {
  const words = spokenWords(text);
  const sentences = Math.max(1, narrationSentences(text).length);
  if (words.length === 0) return undefined;
  const counts = words.map(syllables);
  const total = counts.reduce((sum, n) => sum + n, 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (total / words.length);
  const longWords = [...new Set(words.filter((_, i) => (counts[i] ?? 0) >= 3))];
  return { score: Math.round(score * 10) / 10, words: words.length, sentences, longWords };
}
