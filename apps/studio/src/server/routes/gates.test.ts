import { GateDtoSchema, SettingsSchema } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun } from '#core/db/repositories/runs.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTestServer, expectApiError, postJson, type TestServer } from '../testing.ts';

let s: TestServer;

beforeEach(() => {
  s = createTestServer();
});

afterEach(() => s.cleanup());

function newRun(): number {
  const topic = createTopic(s.db, { title: '<example-topic>' });
  return createRun(s.db, {
    topicId: topic.id,
    seriesId: listSeries(s.db)[0]!.id,
    app: SettingsSchema.parse({}),
  }).id;
}

describe('GET /api/runs/:id/gates/:gate', () => {
  it('shows a gate the run has not reached: nothing to review, nothing spent', async () => {
    const runId = newRun();
    const res = await s.app.request(`/api/runs/${runId}/gates/scenes`);
    expect(res.status).toBe(200);
    expect(GateDtoSchema.parse(await res.json())).toMatchObject({
      status: null,
      waiting: false,
      subject: null,
      content: null,
      stills: [],
      draftPath: null,
      cost: { totalUsd: 0, byRole: [] },
    });
  });

  it('404s an unknown run and 400s an unknown gate', async () => {
    await expectApiError(await s.app.request('/api/runs/999/gates/scenes'), 404, 'not_found');
    await expectApiError(await s.app.request('/api/runs/1/gates/final'), 400, 'bad_request');
  });
});

describe('POST /api/runs/:id/gates/:gate', () => {
  it('409s a decision on a gate the run is not waiting at', async () => {
    const runId = newRun();
    const res = await postJson(s.app, `/api/runs/${runId}/gates/research`, {
      action: 'approve',
      subjectId: 1,
    });
    await expectApiError(res, 409, 'conflict');
  });

  it('400s a decision that is not one', async () => {
    const res = await postJson(s.app, `/api/runs/${newRun()}/gates/research`, { action: 'skip' });
    await expectApiError(res, 400, 'bad_request');
  });
});

describe('PUT /api/runs/:id/settings', () => {
  it('409s a run that is not between jobs', async () => {
    const res = await s.app.request(`/api/runs/${newRun()}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: {} }),
    });
    await expectApiError(res, 409, 'conflict');
  });
});
