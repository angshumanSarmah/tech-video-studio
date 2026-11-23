import { describe, expect, it } from 'vitest';
import { createSemaphore } from './semaphore.ts';

/** A task that runs until its `finish` is called; records when it started. */
function gate(started: string[], name: string) {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return {
    task: async () => {
      started.push(name);
      await done;
      return name;
    },
    finish: () => finish(),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createSemaphore', () => {
  it('runs at most `limit` tasks at once and starts the rest in arrival order', async () => {
    const limiter = createSemaphore(2);
    const started: string[] = [];
    const gates = ['a', 'b', 'c', 'd'].map((n) => gate(started, n));
    const results = gates.map((g) => limiter.run(g.task));
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(limiter.active).toBe(2);
    gates[1]?.finish();
    await tick();
    expect(started).toEqual(['a', 'b', 'c']);
    gates[0]?.finish();
    await tick();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    gates[2]?.finish();
    gates[3]?.finish();
    await expect(Promise.all(results)).resolves.toEqual(['a', 'b', 'c', 'd']);
    expect(limiter.active).toBe(0);
  });

  it('frees the slot when a task throws', async () => {
    const limiter = createSemaphore(1);
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('drops a waiter whose signal aborts, without taking a slot', async () => {
    const limiter = createSemaphore(1);
    const started: string[] = [];
    const first = gate(started, 'first');
    const running = limiter.run(first.task);
    const controller = new AbortController();
    const waiting = limiter.run(() => Promise.resolve('never'), controller.signal);
    controller.abort(new Error('stopped'));
    await expect(waiting).rejects.toThrow('stopped');
    const third = limiter.run(() => Promise.resolve('third'));
    first.finish();
    await expect(running).resolves.toBe('first');
    await expect(third).resolves.toBe('third');
  });

  it('rejects a bad limit', () => {
    expect(() => createSemaphore(0)).toThrow(/Invalid concurrency limit/);
  });
});
