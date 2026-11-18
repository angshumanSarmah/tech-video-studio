import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeEventSource,
  installFakeEventSource,
  makeEvent,
  makeRun,
  stubFetch,
} from '#web/testing.ts';
import DashboardView from './DashboardView.vue';

const JOB = {
  id: 12,
  type: 'noop',
  runId: null,
  status: 'queued',
  createdAt: new Date().toISOString(),
};

beforeEach(installFakeEventSource);
afterEach(() => vi.unstubAllGlobals());

async function mountDashboard(runs = [makeRun()]) {
  stubFetch({ 'GET /api/runs': { items: runs }, 'POST /api/dev/noop-job': JOB });
  const wrapper = mount(DashboardView, { global: { plugins: [createPinia()] } });
  await flushPromises();
  return wrapper;
}

describe('DashboardView', () => {
  it('lists runs with the error of a failed run next to its status', async () => {
    const wrapper = await mountDashboard([
      makeRun({ id: 2, status: 'failed', lastError: 'no handler for job type ingest' }),
      makeRun({ id: 1 }),
    ]);

    const rows = wrapper.findAll('[data-testid="run-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.get('[data-testid="run-error"]').text()).toBe('no handler for job type ingest');
    expect(rows[1]!.find('[data-testid="run-error"]').exists()).toBe(false);
  });

  it('shows an empty state without runs', async () => {
    const wrapper = await mountDashboard([]);
    expect(wrapper.find('[data-testid="runs-empty"]').exists()).toBe(true);
  });

  it('starts a noop job and shows its 5 progress events live', async () => {
    const wrapper = await mountDashboard();
    await wrapper.get('[data-testid="start-noop"]').trigger('click');
    await flushPromises();

    const source = FakeEventSource.latest();
    expect(source.url).toBe('/api/events?jobId=12');
    source.open();
    source.emit(makeEvent('job_status', { status: 'queued' }, { jobId: 12 }));
    source.emit(makeEvent('job_status', { status: 'running' }, { jobId: 12 }));
    for (let step = 1; step <= 5; step++) {
      source.emit(
        makeEvent('progress', { pct: step * 20, message: `step ${step}/5` }, { jobId: 12 }),
      );
      await flushPromises();
      expect(wrapper.findAll('[data-testid="progress-event"]')).toHaveLength(step);
    }
    source.emit(makeEvent('job_status', { status: 'done' }, { jobId: 12 }));
    await flushPromises();

    expect(wrapper.get('[data-testid="job-status"]').text()).toBe('done');
    expect(wrapper.get('[data-testid="job-bar"]').attributes('style')).toContain('width: 100%');
    expect(source.closed).toBe(true);
  });

  it('shows the error when the job cannot be started', async () => {
    const wrapper = await mountDashboard();
    stubFetch({
      'POST /api/dev/noop-job': () =>
        Response.json({ error: { code: 'not_found', message: 'No route' } }, { status: 404 }),
    });
    await wrapper.get('[data-testid="start-noop"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('No route');
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
