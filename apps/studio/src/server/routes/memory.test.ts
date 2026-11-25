import {
  MAX_RULES_PER_AGENT,
  MemoryRuleDtoSchema,
  MemoryRuleListResponseSchema,
  UsageSummarySchema,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordExport } from '#core/db/repositories/exports.ts';
import { createRun } from '#core/db/repositories/runs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { TEST_APP_SETTINGS } from '#core/db/testing.ts';
import { createTestServer, expectApiError, postJson, type TestServer } from '../testing.ts';

let s: TestServer;

beforeEach(() => {
  s = createTestServer();
});

afterEach(() => s.cleanup());

function exportedVideo(title: string, hook: string): number {
  const run = createRun(s.db, {
    app: TEST_APP_SETTINGS,
    topicId: createTopic(s.db, { title }).id,
    seriesId: listSeries(s.db)[0]!.id,
  });
  recordExport(s.db, {
    runId: run.id,
    mp4Path: `exports/${run.id}/v.mp4`,
    srtPath: `exports/${run.id}/v.srt`,
    durationMs: 60_000,
    title,
    usage: [{ kind: 'hook', value: hook }],
  });
  return run.id;
}

describe('GET /api/memory/usage', () => {
  it('returns the last N videos, newest first, with counts per kind', async () => {
    exportedVideo('<a>', 'problem/x');
    const newest = exportedVideo('<b>', 'puzzle/y');
    const res = await s.app.request('/api/memory/usage?videos=1');
    expect(res.status).toBe(200);
    const summary = UsageSummarySchema.parse(await res.json());
    expect(summary.videos.map((v) => v.videoRunId)).toEqual([newest]);
    expect(summary.counts.hook).toEqual([{ value: 'puzzle/y', videos: 1 }]);
  });

  it('defaults to the last 10 and refuses a count out of range', async () => {
    const res = await s.app.request('/api/memory/usage');
    expect(UsageSummarySchema.parse(await res.json()).videos).toEqual([]);
    await expectApiError(await s.app.request('/api/memory/usage?videos=0'), 400, 'bad_request');
  });
});

describe('/api/memory/rules', () => {
  const patch = (id: number, body: unknown) =>
    s.app.request(`/api/memory/rules/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const add = async (scope: string, text: string) => {
    const res = await postJson(s.app, '/api/memory/rules', { scope, text });
    expect(res.status).toBe(201);
    return MemoryRuleDtoSchema.parse(await res.json());
  };

  it('adds, lists, switches off and on, edits and deletes a rule', async () => {
    const rule = await add('generator', '  Keep boards sparse.  ');
    expect(rule).toMatchObject({
      scope: 'generator',
      text: 'Keep boards sparse.',
      status: 'active',
    });
    const off = MemoryRuleDtoSchema.parse(
      await (await patch(rule.id, { action: 'deactivate' })).json(),
    );
    expect(off.status).toBe('inactive');
    const list = await s.app.request('/api/memory/rules?status=inactive&scope=generator');
    expect(MemoryRuleListResponseSchema.parse(await list.json()).items.map((r) => r.id)).toEqual([
      rule.id,
    ]);
    const edited = await patch(rule.id, {
      action: 'activate',
      text: 'Keep boards to a few boxes.',
    });
    expect(MemoryRuleDtoSchema.parse(await edited.json())).toMatchObject({ status: 'active' });
    const gone = await s.app.request(`/api/memory/rules/${rule.id}`, { method: 'DELETE' });
    expect(gone.status).toBe(204);
    await expectApiError(
      await s.app.request(`/api/memory/rules/${rule.id}`, { method: 'DELETE' }),
      404,
      'not_found',
    );
  });

  it('refuses a bad text or patch (400), a wrong status move and the cap (409)', async () => {
    await expectApiError(
      await postJson(s.app, '/api/memory/rules', { scope: 'all', text: 'two\nlines' }),
      400,
      'bad_request',
    );
    await expectApiError(
      await postJson(s.app, '/api/memory/rules', { scope: 'researcher', text: 'x' }),
      400,
      'bad_request',
    );
    const rule = await add('curator', 'Do not flag contractions.');
    await expectApiError(await patch(rule.id, {}), 400, 'bad_request');
    await expectApiError(await patch(rule.id, { action: 'accept' }), 409, 'conflict');
    for (let i = 1; i < MAX_RULES_PER_AGENT; i += 1) await add('curator', `<curator-${i}>`);
    const full = await postJson(s.app, '/api/memory/rules', { scope: 'curator', text: 'one more' });
    const { error } = await expectApiError(full, 409, 'conflict');
    expect(error.message).toMatch(/The curator already has 12 active rules/);
  });
});
