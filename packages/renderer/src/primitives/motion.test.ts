import { describe, expect, it } from 'vitest';
import { shakeOffset } from './motion.ts';

describe('shakeOffset', () => {
  it('is still before and after the shake', () => {
    expect(shakeOffset(0, 16)).toBe(0);
    expect(shakeOffset(1, 16)).toBe(0);
  });

  it('moves within the amplitude while it plays, and decays', () => {
    const early = Math.abs(shakeOffset(1 / 12, 16));
    const late = Math.abs(shakeOffset(1 - 1 / 12, 16));
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThanOrEqual(16);
    expect(late).toBeLessThan(early);
  });
});
