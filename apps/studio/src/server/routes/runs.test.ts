import { RunDtoSchema, RunListResponseSchema } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { FIRST_RUN_JOB_TYPE } from '#core/services/runs.ts';
import { createTestServer, expectApiError, postJson, type TestServer } from '../testing.ts';

let s: TestServer;
let topicId: number;
let seriesId: number;

beforeEach(() => {
  s = createTestServer();
  topicId = createTopic(s.db, { title: 'Sharding' }).id;
  seriesId = listSeries(s.db)[0]!.id;
});

afterEach(() => s.cleanup());

async function createRunViaApi(body: object = {}) {
  const res = await postJson(s.app, '/api/runs', { topicId, seriesId, ...body });
  expect(res.status).toBe(201);
  return RunDtoSchema.parse(await res.json());
}

describe('POST /api/runs', () => {
  it('creates a queued run with default settings and enqueues its first job', async () => {
    const run = await createRunViaApi();

    expect(run).toMatchObject({ topicId, seriesId, status: 'queued', currentStage: null });
    expect(run.settings.autoApprove.research).toBe(false);
    expect(listRunJobs(s.db, run.id)).toMatchObject([
      { type: FIRST_RUN_JOB_TYPE, status: 'queued' },
    ]);
  });

  it('accepts partial settings', async () => {
    const run = await createRunViaApi({ settings: { autoApprove: { draft: true } } });
    expect(run.settings.autoApprove).toEqual({
      research: false,
      beat_sheet: false,
      scenes: false,
      draft: true,
    });
  });

  it('rejects invalid input with a 400', async () => {
    const res = await postJson(s.app, '/api/runs', {
      topicId,
      seriesId,
      settings: { lengthOverrideSec: 10 },
    });
    const { error } = await expectApiError(res, 400, 'bad_request');
    expect(error.issues?.[0]?.path).toBe('settings.lengthOverrideSec');
  });

  it('returns 404 for an unknown topic or series', async () => {
    const noTopic = await postJson(s.app, '/api/runs', { topicId: 999, seriesId });
    expect((await expectApiError(noTopic, 404, 'not_found')).error.message).toBe(
      'Topic 999 not found',
    );
    await expectApiError(
      await postJson(s.app, '/api/runs', { topicId, seriesId: 999 }),
      404,
      'not_found',
    );
  });
});

describe('GET /api/runs', () => {
  it('lists runs newest first', async () => {
    const first = await createRunViaApi();
    const second = await createRunViaApi();

    const res = await s.app.request('/api/runs');
    const { items } = RunListResponseSchema.parse(await res.json());
    expect(items.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('returns one run by id', async () => {
    const run = await createRunViaApi();
    const res = await s.app.request(`/api/runs/${run.id}`);
    expect(RunDtoSchema.parse(await res.json())).toEqual(run);
  });

  it('returns 404 for an unknown run and 400 for a malformed id', async () => {
    await expectApiError(await s.app.request('/api/runs/999'), 404, 'not_found');
    await expectApiError(await s.app.request('/api/runs/abc'), 400, 'bad_request');
  });
});
