import { ACTION_DURATION_SEC, easeOutCubic } from '../../events/presets.ts';

/**
 * Pure timer logic. Every visible change comes from an anchored event: `count` starts the clock
 * and `reject` expires it. Reaching 00:00 on its own just holds there, in its normal colour.
 *
 * Speed is derived, never authored: the clock covers `durationSec` in the time `count` runs
 * (`ElementState.runSec.count`: until the `reject`, else the `exit` or the end of its beat), so it
 * reaches 00:00 exactly on the expiry word. It never runs slower than real time.
 */

export type TimerInput = {
  durationSec: number;
  /** Seconds since `count` started (`ElementState.elapsed.count`). */
  countElapsed: number | undefined;
  /** Seconds `count` runs (`ElementState.runSec.count`); undefined without a `count` event. */
  countRunSec: number | undefined;
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
  /** Clock seconds per real second; 1 = real time. */
  speed: number;
  /** 0..1 opacity of the speed tag: 0 until `count`, then fades in like an `enter`. */
  tagOpacity: number;
};

/** Clock seconds per real second: `durationSec` over the run, never below 1. */
export function timerSpeed(durationSec: number, runSec: number | undefined): number {
  if (runSec === undefined || runSec <= 0) return 1;
  return Math.max(1, durationSec / runSec);
}

export function timerView(input: TimerInput): TimerView {
  const { durationSec, countElapsed, countRunSec, rejectProgress = 0 } = input;
  const speed = timerSpeed(durationSec, countRunSec);
  const tagOpacity = speedTagOpacity(countElapsed);
  if (rejectProgress > 0) {
    const flash = Math.sin(Math.PI * rejectProgress);
    return { shownSec: 0, fraction: 0, expired: true, flash, speed, tagOpacity };
  }
  const remaining = Math.max(0, durationSec - (countElapsed ?? 0) * speed);
  return {
    shownSec: Math.max(0, Math.ceil(remaining - 1e-9)),
    fraction: remaining / durationSec,
    expired: false,
    flash: 0,
    speed,
    tagOpacity,
  };
}

/**
 * The speed tag appears only once the clock runs: 0 before `count` (and at its first frame), then
 * eased in over an `enter`'s duration. `countElapsed` is 0 while `count` is ahead and undefined
 * without one.
 */
export function speedTagOpacity(countElapsed: number | undefined): number {
  if (countElapsed === undefined) return 0;
  return easeOutCubic(countElapsed / ACTION_DURATION_SEC.enter);
}

/**
 * The fast-forward multiplier as shown on the ring ("60×"), or undefined at real time. Whole
 * numbers from 10× up; one decimal below that, so 1.3× is never shown as "1×".
 */
export function speedLabel(speed: number): string | undefined {
  if (speed <= 1) return undefined;
  const shown = speed >= 10 ? Math.round(speed) : Math.round(speed * 10) / 10;
  return `${shown}×`;
}

/** mm:ss, with minutes growing past two digits if needed (e.g. 100:00). */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
