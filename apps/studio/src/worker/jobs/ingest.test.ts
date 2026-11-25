import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MANY_SOURCES, SourceChunksFileSchema } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readDataJson,
  readDataText,
  resolveDataPath,
  sourceChunksPath,
  sourceUploadPath,
} from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { getRun, listRunSources } from '#core/db/repositories/runs.ts';
import { createSource, getSource } from '#core/db/repositories/sources.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '#core/db/testing.ts';
import { startRun } from '#core/services/runs.ts';
import { addSource as addTopicSource } from '#core/services/sources.ts';
import { buildPdf } from '../ingest/fixtures/pdf-builder.ts';
import { body, fakeWeb, status, type FakeWeb } from '../ingest/testing.ts';
import { runNextJob } from '../runner.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry } from './registry.ts';

const fixture = (name: string) => new URL(`../ingest/fixtures/${name}`, import.meta.url);
const ARTICLE = 'https://notes.example.com/posts/wal';
const BLOCKED = 'https://paywalled.example.com/deep-dive';
const REPO = 'https://github.com/example-org/tidewater';
const REPO_README = 'https://api.github.com/repos/example-org/tidewater/readme';
const NOW = new Date('2026-11-20T10:00:00Z');

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  t.cleanup();
});

function web(): FakeWeb {
  return fakeWeb({
    [ARTICLE]: body(readFileSync(fixture('wal-article.html')), 'text/html; charset=utf-8'),
    [BLOCKED]: status(403),
    [REPO_README]: body(readFileSync(fixture('tidewater-readme.md')), 'application/vnd.github.raw'),
  });
}

type SourceInput =
  { url: string } | { upload: string } | { pasted: { title: string; text: string } };

/** A topic with the given sources and a started run (its `ingest` job queued). */
function startRunWith(inputs: readonly SourceInput[]) {
  const topicId = createTopic(t.db, { title: 'Write-ahead logs' }).id;
  const sourceIds = inputs.map((input) => addSource(topicId, input));
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  const { run, job } = startRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId });
  return { topicId, runId: run.id, jobId: job.id, sourceIds };
}

function addSource(topicId: number, input: SourceInput): number {
  if ('url' in input) return createSource(t.db, { topicId, kind: 'url', url: input.url }).id;
  if ('pasted' in input) {
    return addTopicSource(t.db, t.dataDir, topicId, { kind: 'text', ...input.pasted }).id;
  }
  const hash = createHash('sha256')
    .update(readFileSync(fixture(input.upload)))
    .digest('hex');
  const filePath = sourceUploadPath(topicId, hash, input.upload);
  const abs = resolveDataPath(t.dataDir, filePath);
  mkdirSync(dirname(abs), { recursive: true });
  copyFileSync(fixture(input.upload), abs);
  return createSource(t.db, { topicId, kind: 'file', filePath }).id;
}

async function runIngest(fake: FakeWeb) {
  const handler = ingestJobHandler({
    db: t.db,
    dataDir: t.dataDir,
    fetch: { fetch: fake.fetch, sleep: fake.sleep },
    now: () => NOW,
  });
  const registry = createJobRegistry([handler]);
  await runNextJob({
    db: t.db,
    registry,
    workerId: 'test:1',
    signal: new AbortController().signal,
  });
}

function logs(runId: number) {
  return listEventsSince(t.db, { runId, afterId: 0, limit: 100 })
    .filter((e) => e.type === 'log')
    .map((e) => e.payload as { level: string; message: string });
}

describe('ingest job', () => {
  it('extracts what it can, records each failure with its reason, and pins the rest', async () => {
    const { topicId, runId, jobId, sourceIds } = startRunWith([
      { url: ARTICLE },
      { url: BLOCKED },
      { url: REPO },
      { upload: 'hashing-notes.pdf' },
    ]);
    const [article, blocked, repo, pdf] = sourceIds as [number, number, number, number];
    await runIngest(web());

    expect(getJob(t.db, jobId)!.status).toBe('done');
    expect(getRun(t.db, runId)!.status).not.toBe('failed');

    const failed = getSource(t.db, blocked)!;
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('blocked');
    expect(failed.error).toMatch(/^HTTP 403: the site blocks automated access, so paste its text/);

    const extracted = [article, repo, pdf].map((id) => getSource(t.db, id)!);
    expect(extracted.map((s) => s.status)).toEqual(['extracted', 'extracted', 'extracted']);
    expect(extracted.map((s) => s.title)).toEqual([
      'How a write-ahead log keeps a database honest',
      'tidewater-queue',
      'Consistent Hashing Field Notes',
    ]);
    expect(extracted.every((s) => s.extractedAt?.getTime() === NOW.getTime())).toBe(true);

    const wal = extracted[0]!;
    const text = readDataText(t.dataDir, wal.textPath!);
    expect(text).toContain('Group commit');
    expect(text).not.toContain('HIDDEN-');
    const chunks = SourceChunksFileSchema.parse(
      readDataJson(t.dataDir, sourceChunksPath(topicId, article, wal.contentHash!)),
    );
    expect(chunks.chunks[0]!.id).toBe(`source-${article}#chunk-1`);
    for (const chunk of chunks.chunks) expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);

    expect(listRunSources(t.db, runId).map((s) => s.sourceId)).toEqual([article, repo, pdf]);
    const messages = logs(runId);
    expect(messages).toContainEqual({
      level: 'warn',
      message: expect.stringContaining(`Source ${blocked} (${BLOCKED}) failed: HTTP 403`) as string,
    });
    expect(messages.at(-1)).toEqual({ level: 'info', message: 'Using 3 of 4 sources (1 failed).' });
  });

  it('reuses extracted sources and retries failed ones when a later run ingests the topic', async () => {
    const first = startRunWith([{ url: ARTICLE }, { url: BLOCKED }]);
    await runIngest(web());

    const seriesId = getRun(t.db, first.runId)!.seriesId;
    const second = startRun(t.db, { app: TEST_APP_SETTINGS, topicId: first.topicId, seriesId });
    const fake = web();
    await runIngest(fake);

    expect(getJob(t.db, second.job.id)!.status).toBe('done');
    expect(fake.requests.map((r) => r.url)).toEqual([BLOCKED]);
    expect(listRunSources(t.db, second.run.id)).toEqual(listRunSources(t.db, first.runId));
  });

  it('fails the job, and so the run, when no source could be extracted', async () => {
    const { runId, jobId } = startRunWith([{ url: BLOCKED }, { url: 'ftp://files.example.com/a' }]);
    await runIngest(web());

    const job = getJob(t.db, jobId)!;
    expect(job.status).toBe('failed');
    expect(job.error).toContain('No source could be extracted');
    expect(job.error).toContain('Only http and https URLs are fetched, not ftp:');
    expect(getRun(t.db, runId)!.status).toBe('failed');
  });

  it('fails a topic without sources with a clear message', async () => {
    const { jobId } = startRunWith([]);
    await runIngest(web());
    expect(getJob(t.db, jobId)!.error).toContain('The topic has no sources');
  });

  it('marks a JavaScript-only page empty, says to paste it instead, and goes on with the rest', async () => {
    const shell = 'https://app.example.com/dashboard';
    const fake = fakeWeb({
      [shell]: body(readFileSync(fixture('js-shell.html')), 'text/html; charset=utf-8'),
      [ARTICLE]: body(readFileSync(fixture('wal-article.html')), 'text/html'),
    });
    const { runId, jobId, sourceIds } = startRunWith([{ url: shell }, { url: ARTICLE }]);
    await runIngest(fake);
    const source = getSource(t.db, sourceIds[0]!)!;
    expect(source).toMatchObject({ status: 'failed', errorCode: 'empty' });
    expect(source.error).toBe(
      'The page has almost no readable text (it is probably built by JavaScript, or behind a ' +
        'login). Paste its text as a source instead, or upload the page as a file (.pdf, .md ' +
        'or .txt).',
    );
    expect(getJob(t.db, jobId)!.status).toBe('done');
    expect(listRunSources(t.db, runId).map((s) => s.sourceId)).toEqual([sourceIds[1]]);
  });

  it('reads pasted text as plain text under the title it was given', async () => {
    const text = `Notes from our own load test.\n\n${'Each worker drained 1,200 jobs a minute at steady state. '.repeat(6)}`;
    const { topicId, runId, sourceIds } = startRunWith([
      { pasted: { title: 'Load test, week 3', text } },
    ]);
    await runIngest(fakeWeb({}));
    const source = getSource(t.db, sourceIds[0]!)!;
    expect(source).toMatchObject({ kind: 'text', status: 'extracted', title: 'Load test, week 3' });
    const chunks = SourceChunksFileSchema.parse(
      readDataJson(t.dataDir, sourceChunksPath(topicId, source.id, source.contentHash!)),
    );
    expect(chunks.chunks[0]!.text).toContain('drained 1,200 jobs a minute');
    expect(listRunSources(t.db, runId)).toHaveLength(1);
    expect(logs(runId)).toContainEqual({
      level: 'info',
      message: expect.stringContaining('(pasted: Load test, week 3): text, 1 chunk(s)') as string,
    });
  });

  it(`warns when more than ${MANY_SOURCES} sources share the research budget`, async () => {
    const note = (n: number) => ({
      pasted: { title: `Note ${n}`, text: `Note ${n}. ${'A queue drains in order. '.repeat(12)}` },
    });
    const { runId } = startRunWith(Array.from({ length: MANY_SOURCES + 1 }, (_, i) => note(i + 1)));
    await runIngest(fakeWeb({}));
    expect(logs(runId)).toContainEqual({
      level: 'warn',
      message: expect.stringMatching(
        /^6 sources share one research budget \(more than 5\)/,
      ) as string,
    });
  });

  it('titles a PDF with no title and no text on page 1 by its URL file name', async () => {
    const url = 'https://papers.example.com/pdf/ring-notes.pdf';
    const sentence = 'A hash ring moves only the keys next to a server that joins or leaves.';
    const pdf = buildPdf({ pages: [[], Array.from({ length: 6 }, () => sentence)] });
    const { sourceIds } = startRunWith([{ url }]);
    await runIngest(fakeWeb({ [url]: body(pdf, 'application/pdf') }));
    expect(getSource(t.db, sourceIds[0]!)!.title).toBe('ring-notes');
  });
});
