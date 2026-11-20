import { describe, expect, it } from 'vitest';
import { wordTimingProblems } from './word-checks.ts';

const w = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec });

describe('wordTimingProblems', () => {
  it('accepts full, monotonic coverage inside the audio', () => {
    expect(wordTimingProblems('Hi, there.', [w('hi', 0.1, 0.3), w('there', 0.3, 0.7)], 1)).toEqual(
      [],
    );
  });

  it('reports missing and renamed words', () => {
    expect(wordTimingProblems('a b c', [w('a', 0, 1), w('x', 1, 2)], 3)).toEqual([
      'expected 3 words, got 2',
      'word 1 "x" should be "b"',
    ]);
  });

  it('reports words out of order, inverted spans and words past the audio', () => {
    const problems = wordTimingProblems(
      'a b c',
      [w('a', 0.5, 0.8), w('b', 0.2, 0.4), w('c', 2, 1.9)],
      1.5,
    );
    expect(problems).toEqual([
      'word 1 "b" starts or ends before the previous word (not monotonic)',
      'word 2 "c" has an invalid span 2-1.9s',
      'word 2 "c" ends at 1.9s, past the audio (1.5s)',
    ]);
  });
});
