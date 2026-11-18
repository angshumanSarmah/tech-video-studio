import { RunEventDtoSchema, type RunEventDto } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendRunEvent } from '#core/db/repositories/run-events.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
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

interface SseMessage {
  readonly id: string;
  readonly event: string;
  readonly data: RunEventDto;
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
    data: RunEventDtoSchema.parse(JSON.parse(data)),
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
    const { run } = startRun(s.db, { topicId, seriesId });
    const res = await openStream(`?runId=${run.id}`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reading = readMessages(res, 2);
    appendRunEvent(s.db, { runId: run.id, type: 'progress', payload: { step: 1 } });
    const messages = await reading;

    expect(messages.map((m) => [m.event, m.data.payload])).toEqual([
      ['status', { status: 'queued' }],
      ['progress', { step: 1 }],
    ]);
    expect(messages[1]?.id).toBe(String(messages[1]?.data.id));
  });

  it('only streams the requested run', async () => {
    const { run: a } = startRun(s.db, { topicId, seriesId });
    const { run: b } = startRun(s.db, { topicId, seriesId });
    appendRunEvent(s.db, { runId: a.id, type: 'log' });
    appendRunEvent(s.db, { runId: b.id, type: 'log' });

    const messages = await readMessages(await openStream(`?runId=${b.id}`), 2);
    expect(messages.every((m) => m.data.runId === b.id)).toBe(true);
  });

  it('resumes after Last-Event-ID', async () => {
    const { run } = startRun(s.db, { topicId, seriesId });
    const seen = appendRunEvent(s.db, { runId: run.id, type: 'progress', payload: { step: 1 } });
    appendRunEvent(s.db, { runId: run.id, type: 'progress', payload: { step: 2 } });

    const [next] = await readMessages(await openStream(`?runId=${run.id}`, String(seen.id)), 1);
    expect(next?.data.payload).toEqual({ step: 2 });
  });

  it('without runId, streams only new events across all runs (dashboard)', async () => {
    startRun(s.db, { topicId, seriesId }); // existing event: not replayed
    const res = await openStream('');

    const reading = readMessages(res, 1);
    const { run } = startRun(s.db, { topicId, seriesId });
    const [message] = await reading;

    expect(message?.data).toMatchObject({ runId: run.id, type: 'status' });
  });

  it('returns 404 for an unknown run and 400 for a bad cursor', async () => {
    await expectApiError(await openStream('?runId=999'), 404, 'not_found');
    await expectApiError(await openStream('?runId=abc'), 400, 'bad_request');
    await expectApiError(await openStream('', 'nope'), 400, 'bad_request');
  });
});
