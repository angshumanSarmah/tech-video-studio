import { readFileSync } from 'node:fs';
import {
  SeriesListResponseSchema,
  SourceDtoSchema,
  SourceListResponseSchema,
  TopicDtoSchema,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import type { DryRunResponse } from '#worker/llm/dry-run.ts';
import { Harness } from './harness.ts';

/**
 * Sources and gate 1 (P1C.9 step 9, P1C.2): sources added through the API (pasted text, a CSV
 * upload) reach the Researcher and its notes; thin research and sources that disagree keep gate 1
 * from approving itself, and the gate says why at the top, with each source's length and chunks.
 */

let h: Harness;

beforeEach(() => {
  h = new Harness('rate-limiter');
});

afterEach(() => h.cleanup());

const csvFixture = () =>
  readFileSync(new URL('../worker/ingest/fixtures/broker-latency.csv', import.meta.url));

/** Invented notes a team might paste: their own load test. */
const PASTED = {
  title: 'Our load test, week 3',
  text:
    'We ran the queue at 1,200 jobs per minute for an hour. Workers kept up until the queue ' +
    'held 9,500 messages; past that, the oldest job waited longer than a minute and retries ' +
    'doubled the load. Lowering the batch size to 20 cut the wait but raised the cost per job. ' +
    'We stopped the test when broker south-1 fell behind its replica.',
};

async function json(res: Response | Promise<Response>, status: number): Promise<unknown> {
  const response = await res;
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json();
}

function post(path: string, body: unknown) {
  return h.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function upload(path: string, name: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], name));
  return h.app.request(path, { method: 'POST', body: form });
}

const answer = (notes: ResearchNotes): DryRunResponse => ({
  content: JSON.stringify(notes),
  servedModel: 'recorded',
  finishReason: 'stop',
  usage: null,
});

const PASTED_CHUNK = 'source-1#chunk-1';
const CSV_CHUNK = 'source-2#chunk-1';

/** Thin notes: three facts, one from each kind of source, and a number from a CSV row. */
const THIN_NOTES: ResearchNotes = {
  mechanism: {
    summary: 'Workers take jobs from the queue in order; when jobs arrive faster, waits grow.',
    sourceChunkIds: [PASTED_CHUNK],
    steps: [{ text: 'Workers drain the queue in order.', sourceChunkIds: [PASTED_CHUNK] }],
  },
  plainSummary: 'When jobs arrive faster than workers finish them, everyone waits longer.',
  analogies: [
    {
      analogy: 'A checkout line',
      matches: 'Shoppers wait in order for the cashier.',
      breaksDown: 'Shoppers do not join the line twice when they get bored.',
    },
  ],
  glossary: [
    {
      term: 'Queue depth',
      plainMeaning: 'How many jobs are waiting.',
      sourceChunkIds: [PASTED_CHUNK],
    },
  ],
  facts: [
    {
      id: 'fact-1',
      statement: 'The team ran the queue at 1,200 jobs per minute for an hour.',
      sourceChunkIds: [PASTED_CHUNK],
      confidence: 'high',
    },
    {
      id: 'fact-2',
      statement: 'Past 9,500 messages, the oldest job waited longer than a minute.',
      sourceChunkIds: [PASTED_CHUNK],
      confidence: 'medium',
    },
    {
      id: 'fact-3',
      statement: 'Broker south-1 answers at a p99 latency of 41 ms.',
      sourceChunkIds: [CSV_CHUNK],
      confidence: 'high',
    },
  ],
  numbers: [
    {
      id: 'num-1',
      value: '41',
      unit: 'ms',
      context: 'p99 latency of broker south-1',
      sourceChunkId: CSV_CHUNK,
    },
    {
      id: 'num-2',
      value: '1,200',
      unit: 'jobs per minute',
      context: 'Load test rate',
      sourceChunkId: PASTED_CHUNK,
    },
  ],
  tradeOffs: [
    {
      choice: 'A smaller batch size',
      gains: 'Shorter waits.',
      costs: 'A higher cost per job.',
      sourceChunkIds: [PASTED_CHUNK],
    },
  ],
  rejectedAlternatives: [],
  misconceptions: [],
  failureModes: [],
  hooks: [
    {
      situation: 'The queue holds 9,500 messages and the oldest job waits over a minute.',
      sourceChunkIds: [PASTED_CHUNK],
    },
    {
      situation: 'One broker answers at 41 ms while its neighbour answers at 12 ms.',
      sourceChunkIds: [CSV_CHUNK],
    },
  ],
  openQuestions: [],
};

/**
 * The recorded rate-limiter notes plus a disagreement about a quantity: the store timeout, given
 * as quotaflow's 50 ms default and the incident fix's 150 ms (invented for this test), naming
 * both numbers (`numberIds`, researcher@v4), so it blocks gate 1 under the default rule.
 */
function numericDisagreement(): DryRunResponse {
  const recorded = h.recording('researcher').at(-1)!;
  const notes = JSON.parse(recorded.content!) as ResearchNotes;
  notes.openQuestions.push({
    question:
      'What should the store timeout be? The library defaults to 50 ms; the incident report sets 150 ms.',
    reason: 'disagreement',
    sourceChunkIds: ['source-2#chunk-2', 'source-3#chunk-2'],
    angle: 'serves',
    numberIds: ['num-13', 'num-20'],
  });
  return answer(notes);
}
describe('sources through the API', () => {
  it('adds pasted text and a CSV upload, refuses other files and non-http URLs, and lists them', async () => {
    const topic = TopicDtoSchema.parse(
      await json(post('/api/topics', { title: 'Queue depth' }), 201),
    );
    const sources = `/api/topics/${topic.id}/sources`;

    const pasted = SourceDtoSchema.parse(
      await json(post(sources, { kind: 'text', ...PASTED }), 201),
    );
    expect(pasted).toMatchObject({ kind: 'text', title: PASTED.title, fileName: null, url: null });
    const csv = SourceDtoSchema.parse(
      await json(upload(sources, 'broker-latency.csv', csvFixture()), 201),
    );
    expect(csv).toMatchObject({ kind: 'file', fileName: 'broker-latency.csv', status: 'pending' });

    const refused = (await json(upload(sources, 'page.html', new Uint8Array([60])), 400)) as {
      error: { message: string };
    };
    expect(refused.error.message).toMatch(/only \.md, .*\.docx, \.csv, \.json files are read/);
    await json(post(sources, { kind: 'url', url: 'ftp://files.example.com/a' }), 400);
    await json(post(sources, { kind: 'text', title: 'Empty', text: '   ' }), 400);
    await json(post('/api/topics/999/sources', { kind: 'url', url: 'https://a.example.com' }), 404);

    const list = SourceListResponseSchema.parse(await json(h.app.request(sources), 200));
    expect(list.items.map((s) => [s.kind, s.title ?? s.fileName])).toEqual([
      ['text', PASTED.title],
      ['file', 'broker-latency.csv'],
    ]);
  });
});

describe('gate 1', () => {
  it('cites pasted text and a CSV row value in the notes; thin research waits at the gate, saying why', async () => {
    const topic = TopicDtoSchema.parse(
      await json(post('/api/topics', { title: 'Queue depth' }), 201),
    );
    const sources = `/api/topics/${topic.id}/sources`;
    await json(post(sources, { kind: 'text', ...PASTED }), 201);
    await json(upload(sources, 'broker-latency.csv', csvFixture()), 201);
    const series = SeriesListResponseSchema.parse(await json(h.app.request('/api/series'), 200));
    const run = (await json(
      post('/api/runs', {
        topicId: topic.id,
        seriesId: series.items[0]!.id,
        settings: { autoApprove: { research: true, beat_sheet: true } },
      }),
      201,
    )) as { id: number };

    h.drop('researcher');
    await h.drain({ researcher: [answer(THIN_NOTES)] });

    // The Researcher read the pasted text under its title and the CSV as labelled rows.
    const [call] = listRunLlmCalls(h.t.db, run.id);
    const prompt = JSON.stringify(readDataJson(h.t.dataDir, call!.promptPath));
    expect(prompt).toContain(PASTED.title);
    expect(prompt).toContain(
      'Broker: south-1; Region: ap-south; Partitions: 32; p99 latency (ms): 41',
    );

    expect(getRun(h.t.db, run.id)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_research',
    });
    const gate = await h.gate(run.id, 'research');
    if (gate.content?.gate !== 'research') throw new Error('expected the research gate');
    expect(gate.content.notes.facts[0]!.sourceChunkIds).toEqual([PASTED_CHUNK]);
    expect(gate.content.notes.numbers[0]).toMatchObject({ value: '41', sourceChunkId: CSV_CHUNK });
    expect(gate.checks).toEqual([]);
    expect(gate.blocking.map((line) => line.split(' at ')[0])).toEqual([
      'research_thin_facts',
      'sources_thin',
    ]);
    expect(gate.blocking[0]).toMatch(/Only 3 facts \(at least 6 expected\)/);
    expect(gate.content.sources).toEqual([
      expect.objectContaining({
        sourceId: 1,
        kind: 'text',
        origin: PASTED.title,
        read: expect.objectContaining({
          chars: PASTED.text.length,
          chunks: 1,
          sentChunks: 1,
        }) as unknown,
      }),
      expect.objectContaining({
        sourceId: 2,
        kind: 'file',
        origin: 'broker-latency.csv',
        read: expect.objectContaining({ chunks: 1, sentChunks: 1 }) as unknown,
      }),
    ]);
    expect(gate.warnings).toEqual([]);
  });

  it('a disagreement about a number keeps gate 1 from approving itself; approving goes on', async () => {
    h.approveDisputed = false;
    h.drop('researcher');
    const runId = await h.runUntilWaiting(
      { research: true, beat_sheet: true },
      { researcher: [numericDisagreement()] },
    );

    expect(getRun(h.t.db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_research',
    });
    const gate = await h.gate(runId, 'research');
    expect(gate.blocking).toHaveLength(1);
    expect(gate.blocking[0]).toMatch(
      /^sources_disagree at \$\.openQuestions\[5\]: The sources disagree: /,
    );
    // The numbers it names (`numberIds`, researcher@v4), not a number that shares its chunk.
    expect(gate.blocking[0]).toContain('It involves num-13 = 50, num-20 = 150.');
    if (gate.content?.gate !== 'research') throw new Error('expected the research gate');
    expect(gate.content.sources).toHaveLength(3);
    for (const source of gate.content.sources) {
      expect(source.read!.chars).toBeGreaterThan(1_500);
      expect(source.read!.sentChunks).toBe(source.read!.chunks);
    }
    const pending = h
      .events(runId)
      .find((e) => e.type === 'gate' && e.payload.status === 'pending');
    expect(pending?.payload).toMatchObject({ gate: 'research', blocking: gate.blocking });

    const res = await h.post(runId, 'research', { action: 'approve', subjectId: gate.subject!.id });
    expect(res.status).toBe(200);
    await h.drain({}, 1);
    expect(h.jobs(runId)).toContain('direct');
  });

  it('a disagreement about a choice is an advisory note, and gate 1 approves itself', async () => {
    h.approveDisputed = false;
    const runId = h.start({ autoApprove: { research: true } });
    await h.drain();

    expect(getRun(h.t.db, runId)?.pipelineStep).toBe('gate_beat_sheet');
    const gate = await h.gate(runId, 'research');
    expect(gate).toMatchObject({ status: 'approved', decidedBy: 'auto', blocking: [] });
    expect(gate.warnings).toContainEqual(
      expect.objectContaining({
        code: 'sources_disagree',
        path: '$.openQuestions[0]',
        message: expect.stringMatching(
          /^The sources disagree \(no number involved, so it does not block\): Should limits for a team's own APIs fail open or fail closed\?/,
        ) as string,
      }),
    );
    // The recorded notes mark two uncovered questions as the angle's own.
    expect(gate.warnings.filter((w) => w.code === 'angle_not_covered').map((w) => w.path)).toEqual([
      '$.openQuestions[2]',
      '$.openQuestions[4]',
    ]);
  });

  it('switching the rule to "none" at gate 1 lets the waiting run approve itself', async () => {
    h.approveDisputed = false;
    h.drop('researcher');
    const runId = await h.runUntilWaiting(
      { research: true },
      { researcher: [numericDisagreement()] },
    );
    expect(getRun(h.t.db, runId)?.pipelineStep).toBe('gate_research');

    const res = await h.putSettings(runId, { research: { disagreementBlocks: 'none' } });
    expect(res.status).toBe(200);
    expect(getRun(h.t.db, runId)).toMatchObject({
      pipelineStep: 'direct',
      resolvedSettings: { research: { disagreementBlocks: 'none' } },
    });
  });
});
