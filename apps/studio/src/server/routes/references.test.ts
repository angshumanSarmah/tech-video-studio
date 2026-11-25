import {
  CreateReferenceResponseSchema,
  ReanalyzeReferenceResponseSchema,
  ReferenceDetailDtoSchema,
  ReferenceListResponseSchema,
  ReferenceRecordSchema,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getJob } from '#core/db/repositories/jobs.ts';
import { jobs } from '#core/db/schema.ts';
import { requireReference, saveReferenceRecord, withNames } from '#core/services/references.ts';
import {
  seededRecord,
  SEED_SLUGS,
  seedBreakdown,
  seedRecord,
} from '#core/services/references-testing.ts';
import { eq } from 'drizzle-orm';
import { createTestServer, expectApiError, postJson, type TestServer } from '../testing.ts';

let s: TestServer;
beforeEach(() => {
  s = createTestServer();
});
afterEach(() => s.cleanup());

const put = (id: number, body: unknown) =>
  s.app.request(`/api/references/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function detail(id: number) {
  const res = await s.app.request(`/api/references/${id}`);
  expect(res.status).toBe(200);
  return ReferenceDetailDtoSchema.parse(await res.json());
}

describe('/api/references', () => {
  it('lists the six seeds, ready', async () => {
    const res = await s.app.request('/api/references');
    const { items } = ReferenceListResponseSchema.parse(await res.json());
    expect(items.map((r) => [r.slug, r.status, r.origin])).toEqual(
      SEED_SLUGS.map((slug) => [slug, 'ready', 'seed']),
    );
  });

  it('shows a record with its breakdown and backlog rows', async () => {
    const id = requireReference(s.db, 'ride-hailing-demand-heatmap').id;
    const ref = await detail(id);
    expect(ref.record).toEqual(seededRecord('ride-hailing-demand-heatmap'));
    expect(ref.breakdown).toBe(seedBreakdown('ride-hailing-demand-heatmap'));
    expect(ref.backlog.length).toBeGreaterThan(0);
    expect(ref.backlog.every((b) => b.referenceVideoId === id)).toBe(true);
    await expectApiError(await s.app.request('/api/references/999'), 404, 'not_found');
  });

  it('adds a pasted breakdown whose missing primitive becomes a backlog row', async () => {
    const breakdown = seedBreakdown('live-score-fanout');
    const res = await postJson(s.app, '/api/references', {
      breakdown,
      namesToAvoid: [{ text: 'Scorely', kind: 'brand' }],
    });
    expect(res.status).toBe(202);
    const { id, slug, jobId } = CreateReferenceResponseSchema.parse(await res.json());
    expect(slug).toBe('one-live-sports-event-to-millions-of-phones');
    expect((await detail(id)).status).toBe('pending');

    const record = seedRecord('live-score-fanout');
    const withMissing = {
      ...record,
      unmapped: [
        {
          kind: 'primitive',
          name: 'scoreboard_flip',
          description: 'A split-flap board whose digits flip to a new score.',
          closest: 'counter_transition',
          buildable: 'yes',
        },
      ],
    };
    // What the worker's analyze_reference job saves (the job itself: analyze-reference.test.ts).
    s.db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, jobId)).run();
    const row = requireReference(s.db, id);
    const names = [{ text: 'Scorely', kind: 'brand' as const }];
    const parsed = ReferenceRecordSchema.parse(withMissing);
    s.db.transaction((tx) => saveReferenceRecord(tx, s.dataDir, row, withNames(parsed, names)));
    const ref = await detail(id);
    expect(ref.status).toBe('ready');
    expect(ref.record?.namesToAvoid.map((n) => n.text)).toContain('Scorely');
    expect(ref.backlog.map((b) => [b.name, b.status, b.runId])).toEqual([
      ['scoreboard_flip', 'open', null],
    ]);
  });

  it('keeps screenshots from a multipart upload, and refuses other files', async () => {
    const form = new FormData();
    form.set('breakdown', '# Reference: a shared board\n\nBeats.');
    form.set('namesToAvoid', JSON.stringify([{ text: 'Acme', kind: 'brand' }]));
    form.append('attachments', new File([new Uint8Array([1, 2, 3])], 'one.png'));
    form.append('attachments', new File([new Uint8Array([4, 5])], 'two.jpg'));
    const res = await s.app.request('/api/references', { method: 'POST', body: form });
    expect(res.status).toBe(202);
    const { id, jobId } = CreateReferenceResponseSchema.parse(await res.json());
    expect((await detail(id)).attachmentFiles.map((a) => a.name)).toEqual(['one.png', 'two.jpg']);
    expect(getJob(s.db, jobId)?.payload).toEqual({
      referenceId: id,
      namesToAvoid: [{ text: 'Acme', kind: 'brand' }],
    });

    const bad = new FormData();
    bad.set('breakdown', 'x');
    bad.append('attachments', new File([new Uint8Array([1])], 'clip.mp4'));
    await expectApiError(
      await s.app.request('/api/references', { method: 'POST', body: bad }),
      400,
      'bad_request',
    );
    await expectApiError(
      await postJson(s.app, '/api/references', { breakdown: '' }),
      400,
      'bad_request',
    );
  });

  it('edits a record: checked like the analyst’s answer, backlog synced', async () => {
    const id = requireReference(s.db, 'seat-booking-contention').id;
    const record = seedRecord('seat-booking-contention');
    const bad = await put(id, { record: { ...record, title: 'Seats sold on Ticketo' } });
    const body = await expectApiError(bad, 400, 'bad_request');
    expect(body.error.issues?.[0]).toMatchObject({ path: '$.title' });

    const res = await put(id, { record: { ...record, unmapped: [] } });
    expect(res.status).toBe(200);
    const ref = ReferenceDetailDtoSchema.parse(await res.json());
    expect(ref.backlog).toEqual([]);
  });

  it('analyses again, once at a time', async () => {
    const id = requireReference(s.db, 'food-delivery-eta').id;
    const res = await s.app.request(`/api/references/${id}/reanalyze`, { method: 'POST' });
    expect(res.status).toBe(202);
    const { jobId } = ReanalyzeReferenceResponseSchema.parse(await res.json());
    expect(getJob(s.db, jobId)?.type).toBe('analyze_reference');
    expect((await detail(id)).status).toBe('pending');
    await expectApiError(
      await s.app.request(`/api/references/${id}/reanalyze`, { method: 'POST' }),
      409,
      'conflict',
    );
    await expectApiError(
      await put(id, { record: seedRecord('food-delivery-eta') }),
      409,
      'conflict',
    );
  });
});
