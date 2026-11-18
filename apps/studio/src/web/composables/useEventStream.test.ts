import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { FakeEventSource, installFakeEventSource, makeEvent } from '#web/testing.ts';
import type { EventStreamFilter } from '#web/http/events.ts';
import { useEventStream, type EventStreamOptions } from './useEventStream.ts';
import { isJobFinished, useJobEvents } from './useJobEvents.ts';

beforeEach(installFakeEventSource);
afterEach(() => vi.unstubAllGlobals());

function inScope<T>(fn: () => T) {
  const scope = effectScope();
  const result = scope.run(fn)!;
  return { result, stop: () => scope.stop() };
}

const stream = (filter: EventStreamFilter | null, options?: EventStreamOptions) =>
  inScope(() => useEventStream(() => filter, options));

describe('useEventStream', () => {
  it('stays idle without a filter', () => {
    const { result } = stream(null);
    expect(result.state.value).toBe('idle');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens the filtered URL and collects named events in order', () => {
    const { result } = stream({ jobId: 5 });
    const source = FakeEventSource.latest();
    expect(source.url).toBe('/api/events?jobId=5');
    expect(result.state.value).toBe('connecting');

    source.open();
    const progress = makeEvent('progress', { pct: 20, message: 'step 1/5' }, { jobId: 5 });
    const status = makeEvent('job_status', { status: 'running' }, { jobId: 5 });
    source.emit(status);
    source.emit(progress);

    expect(result.state.value).toBe('open');
    expect(result.events.value).toEqual([status, progress]);
  });

  it('records malformed messages as an error without dropping the stream', () => {
    const { result } = stream({ jobId: 1 });
    FakeEventSource.latest().emitRaw('progress', '{"nope":true}', '9');
    expect(result.error.value).toBe('Malformed event 9');
    expect(result.events.value).toEqual([]);
    expect(result.state.value).not.toBe('closed');
  });

  it('closes when closeWhen matches', () => {
    const { result } = stream({ jobId: 1 }, { closeWhen: (e) => e.type === 'log' });
    const source = FakeEventSource.latest();
    source.emit(makeEvent('log', { level: 'info', message: 'bye' }, { jobId: 1 }));
    expect(source.closed).toBe(true);
    expect(result.state.value).toBe('closed');
  });

  it('reports reconnecting while the browser retries, and an error once it gives up', () => {
    const { result } = stream({ runId: 1 });
    const source = FakeEventSource.latest();
    source.fail(0);
    expect(result.state.value).toBe('reconnecting');
    source.fail(2);
    expect(result.state.value).toBe('closed');
    expect(result.error.value).toBe('Event stream failed');
  });

  it('reopens and resets when the filter changes', async () => {
    const jobId = ref(1);
    const { result } = inScope(() => useEventStream(() => ({ jobId: jobId.value })));
    const first = FakeEventSource.latest();
    first.emit(makeEvent('progress', { pct: 10 }, { jobId: 1 }));

    jobId.value = 2;
    await nextTick();

    expect(first.closed).toBe(true);
    expect(FakeEventSource.latest().url).toBe('/api/events?jobId=2');
    expect(result.events.value).toEqual([]);
  });

  it('closes the source when the scope is disposed', () => {
    const { stop } = stream({ jobId: 1 });
    stop();
    expect(FakeEventSource.latest().closed).toBe(true);
  });
});

describe('useJobEvents', () => {
  it('does nothing until there is a job', () => {
    inScope(() => useJobEvents(null));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('replays the job from the start and closes once it finishes', () => {
    const { result } = inScope(() => useJobEvents(8));
    const source = FakeEventSource.latest();
    expect(source.url).toBe('/api/events?jobId=8');

    source.emit(makeEvent('job_status', { status: 'running' }, { jobId: 8 }));
    expect(source.closed).toBe(false);
    source.emit(makeEvent('job_status', { status: 'done' }, { jobId: 8 }));
    expect(source.closed).toBe(true);
    expect(result.state.value).toBe('closed');
  });

  it.each([
    ['done', true],
    ['failed', true],
    ['running', false],
    ['queued', false],
  ] as const)('isJobFinished(%s) is %s', (status, finished) => {
    expect(isJobFinished(makeEvent('job_status', { status }))).toBe(finished);
  });
});
