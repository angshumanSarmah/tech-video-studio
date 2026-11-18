import { describe, expect, it } from 'vitest';
import { findWordOccurrence, narrationWords, normalizeWord } from './narration.ts';

describe('narrationWords', () => {
  it('splits on whitespace, lowercases and strips edge punctuation', () => {
    expect(narrationWords('  Redis, the "fast" store —  rate-limiter 3.5 min. ')).toEqual([
      'redis',
      'the',
      'fast',
      'store',
      'rate-limiter',
      '3.5',
      'min',
    ]);
  });

  it('returns no words for empty or punctuation-only text', () => {
    expect(narrationWords(' — ... ')).toEqual([]);
  });

  it('keeps inner apostrophes', () => {
    expect(normalizeWord("Don't!")).toBe("don't");
  });
});

describe('findWordOccurrence', () => {
  const words = narrationWords('No token, no request. The bucket says no.');

  it('finds the n-th occurrence ignoring case and punctuation', () => {
    expect(findWordOccurrence(words, 'No', 1)).toBe(0);
    expect(findWordOccurrence(words, 'no,', 2)).toBe(2);
    expect(findWordOccurrence(words, 'no', 3)).toBe(7);
  });

  it('returns undefined when there are not enough occurrences', () => {
    expect(findWordOccurrence(words, 'no', 4)).toBeUndefined();
    expect(findWordOccurrence(words, 'queue', 1)).toBeUndefined();
  });
});
