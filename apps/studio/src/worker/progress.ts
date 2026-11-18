import { PROGRESS_DONE_PCT, type EventPayload } from '@explainer-studio/shared';

export type ProgressUpdate = EventPayload<'progress'>;

export interface ProgressThrottleOptions {
  /** Writes one progress event. */
  readonly write: (update: ProgressUpdate) => void;
  /** Minimum time between two progress events of one job. */
  readonly intervalMs: number;
}

export interface ProgressThrottle {
  /** Reports progress; written now, deferred to the window's end, or replaced by a newer value. */
  report(update: ProgressUpdate): void;
  /** Writes the deferred value now (if any) and cancels the timer. Call before the job ends. */
  flush(): void;
}

/**
 * Leading + trailing throttle, one per job. The first update in a window is written at once;
 * later ones replace a single pending value that is written when the window ends, so the UI never
 * sits on a stale value. `pct: 100` always passes through immediately (dropping the pending one).
 * Uses the global clock and timers, so tests drive it with fake timers.
 */
export function createProgressThrottle({
  write,
  intervalMs,
}: ProgressThrottleOptions): ProgressThrottle {
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let pending: ProgressUpdate | undefined;
  let timer: NodeJS.Timeout | undefined;

  function emit(update: ProgressUpdate): void {
    lastWriteAt = Date.now();
    write(update);
  }

  function cancelTimer(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  function flush(): void {
    cancelTimer();
    const update = pending;
    pending = undefined;
    if (update) emit(update);
  }

  function defer(update: ProgressUpdate): void {
    pending = update;
    timer ??= setTimeout(flush, lastWriteAt + intervalMs - Date.now());
  }

  return {
    report(update) {
      if (update.pct >= PROGRESS_DONE_PCT) {
        cancelTimer();
        pending = undefined;
        emit(update);
      } else if (Date.now() - lastWriteAt >= intervalMs) {
        emit(update);
      } else {
        defer(update);
      }
    },
    flush,
  };
}
