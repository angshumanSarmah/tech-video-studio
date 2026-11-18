import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgressThrottle, type ProgressUpdate } from './progress.ts';

let written: { at: number; pct: number }[];
let start: number;

function setup() {
  return createProgressThrottle({
    intervalMs: 1_000,
    write: (u: ProgressUpdate) => written.push({ at: Date.now() - start, pct: u.pct }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  start = Date.now();
  written = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createProgressThrottle', () => {
  it('writes the first update at once and the latest dropped one when the window ends', async () => {
    const throttle = setup();
    throttle.report({ pct: 10 });
    await vi.advanceTimersByTimeAsync(100);
    throttle.report({ pct: 20 });
    await vi.advanceTimersByTimeAsync(100);
    throttle.report({ pct: 30 });

    expect(written).toEqual([{ at: 0, pct: 10 }]);
    await vi.advanceTimersByTimeAsync(800);
    expect(written).toEqual([
      { at: 0, pct: 10 },
      { at: 1_000, pct: 30 },
    ]);
  });

  it('writes at most one update per second under a steady stream', async () => {
    const throttle = setup();
    for (let i = 1; i <= 30; i++) {
      throttle.report({ pct: i });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1_000);

    const gaps = written.slice(1).map((w, i) => w.at - written[i]!.at);
    expect(gaps.every((gap) => gap >= 1_000)).toBe(true);
    expect(written.at(-1)?.pct).toBe(30);
  });

  it('passes updates spaced a full window apart straight through', async () => {
    const throttle = setup();
    for (let i = 1; i <= 4; i++) {
      throttle.report({ pct: i * 20 });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(written.map((w) => w.pct)).toEqual([20, 40, 60, 80]);
  });

  it('writes 100% immediately and drops the pending value', async () => {
    const throttle = setup();
    throttle.report({ pct: 10 });
    throttle.report({ pct: 50 });
    throttle.report({ pct: 100 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(written).toEqual([
      { at: 0, pct: 10 },
      { at: 0, pct: 100 },
    ]);
  });

  it('flush() writes the pending value now and cancels the timer', async () => {
    const throttle = setup();
    throttle.report({ pct: 10 });
    throttle.report({ pct: 40 });
    throttle.flush();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(written.map((w) => w.pct)).toEqual([10, 40]);
  });

  it('starts a fresh window after an idle gap', async () => {
    const throttle = setup();
    throttle.report({ pct: 10 });
    throttle.report({ pct: 20 });
    await vi.advanceTimersByTimeAsync(3_000);
    throttle.report({ pct: 30 });

    expect(written).toEqual([
      { at: 0, pct: 10 },
      { at: 1_000, pct: 20 },
      { at: 3_000, pct: 30 },
    ]);
  });
});
