/**
 * At most `limit` tasks at once; the rest wait their turn in arrival order (FIFO). The LLM client
 * holds one per process (`llm.maxConcurrent`), shared by every role, around each HTTP request.
 * A waiter whose signal aborts leaves the queue and rejects with the signal's reason.
 */
export interface Semaphore {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Tasks running now (for tests and logs). */
  readonly active: number;
}

export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid concurrency limit ${limit}`);
  let active = 0;
  const waiting: (() => void)[] = [];

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  function acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason as Error);
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const turn = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const at = waiting.indexOf(turn);
        if (at >= 0) waiting.splice(at, 1);
        reject(signal?.reason as Error);
      };
      waiting.push(turn);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  return {
    async run(task, signal) {
      await acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
  };
}
