import { describe, expect, it } from 'vitest';
import { activeWordIndex, displayWords } from './dev-state.ts';

describe('displayWords / activeWordIndex', () => {
  it('keeps tokens as written, one per narration word', () => {
    expect(displayWords('No token, no request — wait.')).toEqual([
      'No',
      'token,',
      'no',
      'request',
      'wait.',
    ]);
  });

  it('finds the last word that has started', () => {
    const words = [0, 1, 2].map((i) => ({ text: `w${i}`, startSec: i, endSec: i + 0.5 }));
    expect(activeWordIndex(words, -0.1)).toBe(-1);
    expect(activeWordIndex(words, 1.7)).toBe(1);
    expect(activeWordIndex(words, 9)).toBe(2);
  });
});
