import { EventDtoSchema, type EventDto } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendEvent } from '#core/db/repositories/events.ts';
import { enqueueJob } from '#core/db/repositories/jobs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { TEST_APP_SETTINGS } from '#core/db/testing.ts';
import { startRun } from '#core/services/runs.ts';
import { createTestServer, expectApiError, type TestServer } from '../testing.ts';

let s: TestServer;
let topicId: number;
let seriesId: number;

beforeEach(() => {
  s = createTestServer();
  topicId = createTopic(s.db, { title: 'Queues' }).id;
  seriesId = listSeries(s.db)[0]!.id;
});

afterEach(() => s.cleanup());

const LOG = { level: 'info', message: 'hello' } as const;

interface SseMessage {
  readonly id: string;
  readonly event: string;
  readonly data: EventDto;
}

function parseBlock(block: string): SseMessage | undefined {
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = /^(\w+): ?(.*)$/.exec(line);
    if (match) fields.set(match[1]!, match[2]!);
  }
  const data = fields.get('data');
  if (data === undefined) return undefined; // keep-alive comment
  return {
    id: fields.get('id') ?? '',
    event: fields.get('event') ?? '',
    data: EventDtoSchema.parse(JSON.parse(data)),
  };
}

/** Reads `count` SSE messages, then cancels the stream (as a closing browser tab would). */
async function readMessages(res: Response, count: number): Promise<SseMessage[]> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const messages: SseMessage[] = [];
  let buffer = '';
  while (messages.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const message = parseBlock(block);
      if (message) messages.push(message);
    }
  }
  await reader.cancel();
  return messages;
}

function openStream(query: string, lastEventId?: string): Promise<Response> {
  const headers: Record<string, string> = lastEventId ? { 'Last-Event-ID': lastEventId } : {};
  return Promise.resolve(s.app.request(`/api/events${query}`, { headers }));
}

describe('GET /api/events', () => {
  it("replays a run's events from the start, then streams new ones", async () => {
    const { run } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    const res = await openStream(`?runId=${run.id}`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reading = readMessages(res, 2);
    appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 10 } });
    const messages = await reading;

    expect(messages.map((m) => [m.event, m.data.payload])).toEqual([
      ['run_status', { status: 'queued', step: 'ingest' }],
      ['progress', { pct: 10 }],
    ]);
    expect(messages[1]?.id).toBe(String(messages[1]?.data.id));
  });

  it('only streams the requested run', async () => {
    const { run: a } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    const { run: b } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    appendEvent(s.db, { runId: a.id, type: 'log', payload: LOG });
    appendEvent(s.db, { runId: b.id, type: 'log', payload: LOG });

    const messages = await readMessages(await openStream(`?runId=${b.id}`), 2);
    expect(messages.every((m) => m.data.runId === b.id)).toBe(true);
  });

  it('resumes after Last-Event-ID', async () => {
    const { run } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    const seen = appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 10 } });
    appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 20 } });

    const [next] = await readMessages(await openStream(`?runId=${run.id}`, String(seen.id)), 1);
    expect(next?.data.payload).toEqual({ pct: 20 });
  });

  it('starts after the snapshot cursor, so a page load never replays history', async () => {
    const { run } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 10 } });
    const detail = (await (await s.app.request(`/api/runs/${run.id}`)).json()) as {
      lastEventId: number;
    };
    appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 20 } });

    const res = await openStream(`?runId=${run.id}&after=${detail.lastEventId}`);
    const [next] = await readMessages(res, 1);
    expect(next?.data.payload).toEqual({ pct: 20 });
  });

  it('Last-Event-ID wins over after (reconnect)', async () => {
    const { run } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    const first = appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 10 } });
    appendEvent(s.db, { runId: run.id, type: 'progress', payload: { pct: 20 } });

    const res = await openStream(`?runId=${run.id}&after=0`, String(first.id));
    const [next] = await readMessages(res, 1);
    expect(next?.data.payload).toEqual({ pct: 20 });
  });

  it('streams the events of a job without a run', async () => {
    const job = enqueueJob(s.db, { type: 'noop' });
    const other = enqueueJob(s.db, { type: 'noop' });
    appendEvent(s.db, { jobId: other.id, type: 'progress', payload: { pct: 50 } });
    appendEvent(s.db, { jobId: job.id, type: 'job_status', payload: { status: 'running' } });
    appendEvent(s.db, { jobId: job.id, type: 'progress', payload: { pct: 20 } });

    const messages = await readMessages(await openStream(`?jobId=${job.id}`), 2);
    expect(messages.map((m) => [m.event, m.data.runId, m.data.jobId])).toEqual([
      ['job_status', null, job.id],
      ['progress', null, job.id],
    ]);
  });

  it('without runId, streams only new events across all runs (dashboard)', async () => {
    startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId }); // existing event: not replayed
    const res = await openStream('');

    const reading = readMessages(res, 1);
    const { run } = startRun(s.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
    const [message] = await reading;

    expect(message?.data).toMatchObject({ runId: run.id, type: 'run_status' });
  });

  it('returns 404 for an unknown run or job and 400 for bad input', async () => {
    await expectApiError(await openStream('?runId=999'), 404, 'not_found');
    await expectApiError(await openStream('?jobId=999'), 404, 'not_found');
    await expectApiError(await openStream('?runId=1&jobId=1'), 400, 'bad_request');
    await expectApiError(await openStream('?after=-1'), 400, 'bad_request');
    await expectApiError(await openStream('?runId=abc'), 400, 'bad_request');
    await expectApiError(await openStream('', 'nope'), 400, 'bad_request');
  });
});
