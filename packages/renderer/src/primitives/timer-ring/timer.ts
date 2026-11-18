/**
 * Pure timer logic. Every visible change comes from an anchored event: `count` starts the clock
 * and `reject` expires it. Reaching 00:00 on its own just holds there, in its normal colour.
 */

export type TimerInput = {
  durationSec: number;
  speed: number;
  /** Seconds since `count` started (`ElementState.elapsed.count`). */
  countElapsed: number | undefined;
  /** Progress of `reject` (`ElementState.actions.reject`); > 0 once it has started. */
  rejectProgress: number | undefined;
};

export type TimerView = {
  /** Whole seconds shown (rounded up, so 9.2 s left shows 00:10). */
  shownSec: number;
  /** Ring fill, 1 = full, 0 = empty. */
  fraction: number;
  expired: boolean;
  /** 0..1 flash intensity of the expiry: rises and falls while `reject` plays. */
  flash: number;
};

export function timerView(input: TimerInput): TimerView {
  const { durationSec, speed, countElapsed, rejectProgress = 0 } = input;
  if (rejectProgress > 0) {
    return { shownSec: 0, fraction: 0, expired: true, flash: Math.sin(Math.PI * rejectProgress) };
  }
  const remaining = Math.max(0, durationSec - (countElapsed ?? 0) * speed);
  return {
    shownSec: Math.max(0, Math.ceil(remaining - 1e-9)),
    fraction: remaining / durationSec,
    expired: false,
    flash: 0,
  };
}

/** mm:ss, with minutes growing past two digits if needed (e.g. 100:00). */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
