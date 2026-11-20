import { narrationWords, type TimedWord } from '@explainer-studio/shared';

/** Words may end this far past the WAV's end (timestamp rounding) before it counts as a problem. */
const END_TOLERANCE_SEC = 0.05;

/**
 * Why a word list cannot be used as timing for `text`; empty when it can. Checks that it covers
 * every `narrationWords(text)` word in order, and that times are monotonic and inside the audio.
 */
export function wordTimingProblems(
  text: string,
  words: readonly TimedWord[],
  durationSec: number,
): string[] {
  const expected = narrationWords(text);
  const problems: string[] = [];
  if (words.length !== expected.length) {
    problems.push(`expected ${expected.length} words, got ${words.length}`);
  }
  for (const [i, word] of words.entries()) {
    const label = `word ${i} "${word.text}"`;
    if (expected[i] !== undefined && word.text !== expected[i]) {
      problems.push(`${label} should be "${expected[i]}"`);
    }
    if (word.startSec < 0 || word.endSec < word.startSec) {
      problems.push(`${label} has an invalid span ${word.startSec}-${word.endSec}s`);
    }
    if (word.endSec > durationSec + END_TOLERANCE_SEC) {
      problems.push(`${label} ends at ${word.endSec}s, past the audio (${durationSec}s)`);
    }
    const previous = words[i - 1];
    if (previous && (word.startSec < previous.startSec || word.endSec < previous.endSec)) {
      problems.push(`${label} starts or ends before the previous word (not monotonic)`);
    }
  }
  return problems;
}
