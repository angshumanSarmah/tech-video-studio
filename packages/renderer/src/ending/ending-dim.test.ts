import { describe, expect, it } from 'vitest';
import { ACTION_DURATION_SEC, DIM_FADE } from '../events/presets.ts';
import { endingBoardOpacity } from './ending-dim.ts';

describe('endingBoardOpacity', () => {
  it('leaves the board alone before the card and without one', () => {
    expect(endingBoardOpacity(10, 20, 30)).toBe(1);
    expect(endingBoardOpacity(10, undefined, 30)).toBe(1);
  });

  it('dims the board like an overlay once the card has entered', () => {
    expect(endingBoardOpacity(20, 20, 30)).toBe(1);
    const settled = 20 + Math.ceil(ACTION_DURATION_SEC.dim * 30);
    expect(endingBoardOpacity(settled, 20, 30)).toBeCloseTo(1 - DIM_FADE);
  });
});
