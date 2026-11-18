import { describe, expect, it } from 'vitest';
import { anchorWordIndex, resolveAnchorSec } from './anchors.ts';
import { narrationWords } from './narration.ts';
import type { BeatTiming } from './timing.ts';

const words = narrationWords('No token, no request. The bucket says no.');

/** Beat from 2 s to 6 s; word i starts at 2 + 0.5 i. */
const beat: BeatTiming = {
  beatId: 'b',
  startSec: 2,
  endSec: 6,
  words: words.map((text, i) => ({ text, startSec: 2 + i * 0.5, endSec: 2.4 + i * 0.5 })),
};

describe('anchorWordIndex', () => {
  it('returns word indexes inside the narration', () => {
    expect(anchorWordIndex({ type: 'word', index: 3 }, words)).toBe(3);
    expect(anchorWordIndex({ type: 'word', index: 8 }, words)).toBeUndefined();
  });

  it('finds the n-th occurrence of a word, ignoring case and punctuation', () => {
    expect(anchorWordIndex({ type: 'word_text', text: 'No', occurrence: 2 }, words)).toBe(2);
    expect(anchorWordIndex({ type: 'word_text', text: 'no', occurrence: 3 }, words)).toBe(7);
    expect(
      anchorWordIndex({ type: 'word_text', text: 'no', occurrence: 4 }, words),
    ).toBeUndefined();
  });

  it('is undefined for beat-edge anchors', () => {
    expect(anchorWordIndex({ type: 'beat', edge: 'start', offsetSec: 0 }, words)).toBeUndefined();
  });
});

describe('resolveAnchorSec', () => {
  it('resolves word anchors to the start of the word', () => {
    expect(resolveAnchorSec({ type: 'word', index: 0 }, beat, words)).toBe(2);
    expect(
      resolveAnchorSec({ type: 'word_text', text: 'bucket', occurrence: 1 }, beat, words),
    ).toBe(4.5);
  });

  it('resolves beat edges plus offsets', () => {
    expect(resolveAnchorSec({ type: 'beat', edge: 'start', offsetSec: 0.5 }, beat, words)).toBe(
      2.5,
    );
    expect(resolveAnchorSec({ type: 'beat', edge: 'end', offsetSec: -1 }, beat, words)).toBe(5);
  });

  it('clamps beat-edge offsets to the beat', () => {
    expect(resolveAnchorSec({ type: 'beat', edge: 'start', offsetSec: 10 }, beat, words)).toBe(6);
    expect(resolveAnchorSec({ type: 'beat', edge: 'end', offsetSec: -10 }, beat, words)).toBe(2);
  });

  it('is undefined when a word anchor matches no word', () => {
    expect(resolveAnchorSec({ type: 'word_text', text: 'redis', occurrence: 1 }, beat, words)).toBe(
      undefined,
    );
  });
});
