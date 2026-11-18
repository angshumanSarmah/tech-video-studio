export interface PollLoopOptions {
  readonly intervalMs: number;
  readonly tick: () => Promise<void>;
  readonly onError: (error: unknown) => void;
}

export interface PollLoop {
  /** Stops scheduling new ticks and waits for the in-flight tick to settle. */
  stop(): Promise<void>;
}

/**
 * Runs `tick` repeatedly, never overlapping: the next tick is scheduled
 * `intervalMs` after the previous one settles. Errors are reported, not fatal.
 */
export function startPollLoop({ intervalMs, tick, onError }: PollLoopOptions): PollLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    try {
      await tick();
    } catch (error) {
      onError(error);
    }
    if (!stopped) timer = setTimeout(schedule, intervalMs);
  }

  function schedule(): void {
    inFlight = run();
  }

  schedule();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
