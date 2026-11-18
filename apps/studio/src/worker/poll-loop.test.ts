import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPollLoop } from './poll-loop.ts';

describe('startPollLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks immediately, then once per interval', async () => {
    const tick = vi.fn(() => Promise.resolve());
    const loop = startPollLoop({ intervalMs: 100, tick, onError: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(tick).toHaveBeenCalledTimes(3);

    await loop.stop();
  });

  it('reports tick errors and keeps polling', async () => {
    const error = new Error('boom');
    const tick = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const loop = startPollLoop({ intervalMs: 10, tick, onError });

    await vi.advanceTimersByTimeAsync(15);
    expect(onError).toHaveBeenCalledWith(error);
    expect(tick).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it('stop() waits for the in-flight tick and prevents further ticks', async () => {
    let release!: () => void;
    const tick = vi.fn(() => new Promise<void>((r) => (release = r)));
    const loop = startPollLoop({ intervalMs: 10, tick, onError: vi.fn() });

    let stopped = false;
    const stopping = loop.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
