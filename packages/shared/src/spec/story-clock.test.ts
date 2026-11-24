import { describe, expect, it } from 'vitest';
import { storyClockUnit } from './story-clock.ts';

const clock = (from: string, to: string, startValue: number, endValue: number) => ({
  from,
  to,
  startValue,
  endValue,
});

describe('storyClockUnit', () => {
  it('takes the unit when the clock sets one', () => {
    expect(
      storyClockUnit({ ...clock('256 values', '32,000 entries', 256, 32000), unit: 'sec' }),
    ).toBe('sec');
    expect(storyClockUnit({ ...clock('ORDER', 'DOORBELL', 0, 112), unit: 'count' })).toBe('count');
  });

  it('infers a count when a label writes the clock’s own start or end value', () => {
    expect(storyClockUnit(clock('256 byte values', '32,000 entries', 256, 32000))).toBe('count');
    expect(storyClockUnit(clock('one shard', '12 shards', 1, 12))).toBe('count');
  });

  it('infers story seconds otherwise: labels that name moments, or other numbers', () => {
    expect(storyClockUnit(clock('ORDER', 'DOORBELL', 0, 112))).toBe('sec');
    expect(storyClockUnit(clock('first HTTP 429', 'page 3 loads', 0, 90))).toBe('sec');
  });
});
