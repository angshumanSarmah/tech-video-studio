import { describe, expect, it } from 'vitest';
import { visualWords } from './visual-words.ts';

describe('visualWords', () => {
  it('finds colours, shapes and on-screen actions as whole words', () => {
    expect(visualWords('But one slow job stretches into a long bar.')).toEqual(['bar']);
    expect(visualWords('The request turns red and the boxes light up.')).toEqual([
      'red',
      'box',
      'light up',
    ]);
    expect(visualWords('As shown on screen, the queue fades.')).toEqual([
      'shown',
      'on screen',
      'fades',
    ]);
  });

  it('never inside a longer word, and not in technical terms', () => {
    expect(visualWords('Redis keeps a bare record; the barrier holds.')).toEqual([]);
    expect(visualWords('A red-black tree and a blue-green deployment.')).toEqual([]);
    expect(visualWords('Think of the service as a black box.')).toEqual([]);
  });
});
