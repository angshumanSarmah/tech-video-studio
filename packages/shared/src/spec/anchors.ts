import { findWordOccurrence } from './narration.ts';
import type { EventAnchor } from './scene.ts';
import type { BeatTiming } from './timing.ts';

/**
 * Index into `words` (the beat's `narrationWords()`) that a word anchor points at; undefined for
 * beat-edge anchors and for anchors that match no word.
 */
export function anchorWordIndex(anchor: EventAnchor, words: readonly string[]): number | undefined {
  if (anchor.type === 'word') return anchor.index < words.length ? anchor.index : undefined;
  if (anchor.type === 'word_text') {
    return findWordOccurrence(words, anchor.text, anchor.occurrence);
  }
  return undefined;
}

/**
 * Time (seconds on the narration track) an anchor resolves to: the start of its word, or the beat
 * edge plus its offset, clamped to the beat. Undefined when a word anchor matches no word.
 *
 * `words` is the beat's `narrationWords()`; `beat.words` holds one timed entry per word.
 */
export function resolveAnchorSec(
  anchor: EventAnchor,
  beat: BeatTiming,
  words: readonly string[],
): number | undefined {
  if (anchor.type === 'beat') {
    const edge = anchor.edge === 'start' ? beat.startSec : beat.endSec;
    return clamp(edge + anchor.offsetSec, beat.startSec, beat.endSec);
  }
  const index = anchorWordIndex(anchor, words);
  return index === undefined ? undefined : beat.words[index]?.startSec;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
