import { describe, expect, it } from 'vitest';
import { formatClock, timerView } from './timer.ts';

const base = { durationSec: 600, speed: 1, countElapsed: undefined, rejectProgress: undefined };

describe('timerView', () => {
  it('shows the full duration until the count starts', () => {
    expect(timerView(base)).toEqual({ shownSec: 600, fraction: 1, expired: false, flash: 0 });
    expect(timerView({ ...base, countElapsed: 0 }).shownSec).toBe(600);
  });

  it('ticks down at `speed`, rounding the shown seconds up', () => {
    expect(timerView({ ...base, countElapsed: 0.2 }).shownSec).toBe(600);
    expect(timerView({ ...base, countElapsed: 1 }).shownSec).toBe(599);
    const fast = timerView({ ...base, speed: 30, countElapsed: 10 });
    expect(fast.shownSec).toBe(300);
    expect(fast.fraction).toBeCloseTo(0.5);
  });

  it('holds 00:00 in its normal colour when it runs out with no reject', () => {
    expect(timerView({ ...base, speed: 60, countElapsed: 20 })).toEqual({
      shownSec: 0,
      fraction: 0,
      expired: false,
      flash: 0,
    });
  });

  it('expires only on reject: 00:00, empty, and a flash that rises and falls', () => {
    expect(timerView({ ...base, countElapsed: 5, rejectProgress: 0 }).expired).toBe(false);
    const mid = timerView({ ...base, countElapsed: 5, rejectProgress: 0.5 });
    expect(mid).toMatchObject({ shownSec: 0, fraction: 0, expired: true });
    expect(mid.flash).toBeCloseTo(1);
    const done = timerView({ ...base, countElapsed: 5, rejectProgress: 1 });
    expect(done.expired).toBe(true);
    expect(done.flash).toBeCloseTo(0);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(5999)).toBe('99:59');
  });
});
