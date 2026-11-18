import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { FakeEventSource, installFakeEventSource, makeRun, stubFetch } from '#web/testing.ts';
import { useRunEvents } from './useRunEvents.ts';

beforeEach(installFakeEventSource);
afterEach(() => vi.unstubAllGlobals());

describe('useRunEvents', () => {
  it('streams only events after the snapshot cursor', async () => {
    stubFetch({ 'GET /api/runs/3': { ...makeRun({ id: 3 }), lastEventId: 41 } });
    const result = effectScope().run(() => useRunEvents(3))!;
    expect(FakeEventSource.instances).toHaveLength(0);

    await flushPromises();

    expect(result.run.value).toMatchObject({ id: 3, lastEventId: 41 });
    expect(FakeEventSource.latest().url).toBe('/api/events?runId=3&after=41');
  });

  it('reports a failed snapshot load and never opens a stream', async () => {
    stubFetch({
      'GET /api/runs/9': () =>
        Response.json(
          { error: { code: 'not_found', message: 'Run 9 not found' } },
          { status: 404 },
        ),
    });
    const result = effectScope().run(() => useRunEvents(9))!;
    await flushPromises();

    expect(result.error.value).toBe('Run 9 not found');
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
