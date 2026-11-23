import { describe, expect, it } from 'vitest';
import {
  findWordOccurrence,
  narrationSentences,
  narrationWords,
  normalizeWord,
  sentenceStartIndexes,
} from './narration.ts';

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

  // These are the cases TTS output must be mapped back onto (docs/TODO.md, P1B.1 / P1B.2).
  it('keeps hyphenated words and formatted numbers as one word each', () => {
    expect(narrationWords('A write-through cache holds 1,00,000 keys at 19.4 ms.')).toEqual([
      'a',
      'write-through',
      'cache',
      'holds',
      '1,00,000',
      'keys',
      'at',
      '19.4',
      'ms',
    ]);
  });

  it('joins words around an unspaced em dash, but not a spaced one', () => {
    expect(narrationWords('fast—cheap')).toEqual(['fast—cheap']);
    expect(narrationWords('fast — cheap')).toEqual(['fast', 'cheap']);
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

describe('narrationSentences and sentenceStartIndexes', () => {
  const text = 'The queue grows. Why? Workers stall… Then it drains — slowly.';

  it('splits after sentence punctuation followed by whitespace', () => {
    expect(narrationSentences(text)).toEqual([
      'The queue grows.',
      'Why?',
      'Workers stall…',
      'Then it drains — slowly.',
    ]);
  });

  it('gives the narration word index each sentence starts at', () => {
    const words = narrationWords(text);
    const starts = sentenceStartIndexes(text);
    expect(starts).toEqual([0, 3, 4, 6]);
    expect(starts.map((i) => words[i])).toEqual(['the', 'why', 'workers', 'then']);
  });

  it('drops pieces without words and keeps a decimal inside its sentence', () => {
    expect(narrationSentences('It takes 3.5 ms. — ')).toEqual(['It takes 3.5 ms.']);
    expect(sentenceStartIndexes('')).toEqual([]);
  });
});
