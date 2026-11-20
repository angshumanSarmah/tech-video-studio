import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from './cues.ts';
import { activeWordIndex, cueAt, underlineSpan, WORD_SLIDE_SEC } from './subtitle-state.ts';

const cue: SubtitleCue = {
  beatId: 'hook',
  startSec: 1,
  endSec: 2.5,
  text: 'one two three',
  width: 300,
  scale: 1,
  words: [
    { text: 'one', startSec: 1, endSec: 1.3, x: 0, width: 80 },
    { text: 'two', startSec: 1.4, endSec: 1.7, x: 100, width: 90 },
    { text: 'three', startSec: 1.8, endSec: 2.2, x: 210, width: 90 },
  ],
};

describe('cueAt', () => {
  it('shows a cue from its start until (not including) its end', () => {
    expect(cueAt([cue], 0.99)).toBeUndefined();
    expect(cueAt([cue], 1)).toBe(cue);
    expect(cueAt([cue], 2.49)).toBe(cue);
    expect(cueAt([cue], 2.5)).toBeUndefined();
  });
});

describe('activeWordIndex', () => {
  it('is the last word that has started', () => {
    expect([1, 1.35, 1.4, 1.79, 2.4].map((s) => activeWordIndex(cue, s))).toEqual([0, 0, 1, 1, 2]);
  });
});

describe('underlineSpan', () => {
  it('sits on the first word with no slide in', () => {
    expect(underlineSpan(cue, 1)).toEqual({ x: 0, width: 80 });
  });

  it(`slides from the previous word to the current one over ${WORD_SLIDE_SEC * 1000} ms`, () => {
    expect(underlineSpan(cue, 1.4)).toEqual({ x: 0, width: 80 });
    const mid = underlineSpan(cue, 1.4 + WORD_SLIDE_SEC / 2);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.width).toBeCloseTo(85);
    expect(underlineSpan(cue, 1.4 + WORD_SLIDE_SEC)).toEqual({ x: 100, width: 90 });
    expect(underlineSpan(cue, 1.7)).toEqual({ x: 100, width: 90 });
  });
});
