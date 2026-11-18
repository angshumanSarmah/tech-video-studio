import { describe, expect, it } from 'vitest';
import { formatClock, speedLabel, timerSpeed, timerView } from './timer.ts';

const base = {
  durationSec: 600,
  countElapsed: undefined,
  countRunSec: undefined,
  rejectProgress: undefined,
};

describe('timerSpeed', () => {
  it('covers the duration in the run, so a reject run ends exactly at 00:00', () => {
    expect(timerSpeed(600, 10)).toBe(60);
    const atReject = timerView({ ...base, countRunSec: 10, countElapsed: 10 });
    expect(atReject).toMatchObject({ shownSec: 0, fraction: 0, expired: false });
  });

  it('never runs slower than real time', () => {
    expect(timerSpeed(5, 8)).toBe(1);
    const view = timerView({ ...base, durationSec: 5, countRunSec: 8, countElapsed: 3 });
    expect(view.shownSec).toBe(2);
  });

  it('runs at real time without a count or with an empty run', () => {
    expect(timerSpeed(600, undefined)).toBe(1);
    expect(timerSpeed(600, 0)).toBe(1);
  });
});

describe('timerView', () => {
  it('shows the full duration until the count starts', () => {
    expect(timerView(base)).toEqual({
      shownSec: 600,
      fraction: 1,
      expired: false,
      flash: 0,
      speed: 1,
    });
    expect(timerView({ ...base, countRunSec: 10, countElapsed: 0 }).shownSec).toBe(600);
  });

  it('ticks down at the derived speed, rounding the shown seconds up', () => {
    const half = timerView({ ...base, countRunSec: 20, countElapsed: 10 });
    expect(half.speed).toBe(30);
    expect(half.shownSec).toBe(300);
    expect(half.fraction).toBeCloseTo(0.5);
    expect(timerView({ ...base, countRunSec: 600, countElapsed: 0.2 }).shownSec).toBe(600);
  });

  it('holds 00:00 in its normal colour when it runs out with no reject', () => {
    expect(timerView({ ...base, countRunSec: 10, countElapsed: 20 })).toMatchObject({
      shownSec: 0,
      fraction: 0,
      expired: false,
      flash: 0,
    });
  });

  it('expires only on reject: 00:00, empty, and a flash that rises and falls', () => {
    const running = { ...base, countRunSec: 10, countElapsed: 5 };
    expect(timerView({ ...running, rejectProgress: 0 }).expired).toBe(false);
    const mid = timerView({ ...running, rejectProgress: 0.5 });
    expect(mid).toMatchObject({ shownSec: 0, fraction: 0, expired: true });
    expect(mid.flash).toBeCloseTo(1);
    const done = timerView({ ...running, rejectProgress: 1 });
    expect(done.expired).toBe(true);
    expect(done.flash).toBeCloseTo(0);
  });
});

describe('speedLabel', () => {
  it('is hidden at real time', () => {
    expect(speedLabel(1)).toBeUndefined();
  });

  it('rounds to whole numbers from 10× and to one decimal below', () => {
    expect(speedLabel(59.6)).toBe('60×');
    expect(speedLabel(2)).toBe('2×');
    expect(speedLabel(1.34)).toBe('1.3×');
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
