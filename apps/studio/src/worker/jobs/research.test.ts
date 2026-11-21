import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ResearchNotesSchema,
  researchNotesProblems,
  SettingsSchema,
  SourceChunksFileSchema,
  type ResearchSettings,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson, readDataText, sourceChunksPath } from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRunStep, startRunStep } from '#core/db/repositories/run-steps.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { loadPromptTemplates, promptId, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import {
  buildOversizedSource,
  RELEVANT_MARKER,
} from '../agents/researcher/fixtures/oversized-source.ts';
import { citableChunks } from '../agents/researcher/input.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '../agents/researcher/testing.ts';
import { createLlmClient } from '../llm/client.ts';
import { dryRunTransport, loadDryRunFixtures, type DryRunResponse } from '../llm/dry-run.ts';
import { runNextJob } from '../runner.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry, type JobRegistry } from './registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './research.ts';

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});
/** Every recorded attempt, repairs included; the last one is the answer that passed. */
const recorded = loadDryRunFixtures(RATE_LIMITER_RESPONSES_DIR).researcher!;
const recordedAnswer = recorded.at(-1)!;
const recordedContent = recordedAnswer.content!;

let t: TestDb;
let scratch: string;

beforeEach(() => {
  t = createTestDb();
  scratch = mkdtempSync(join(tmpdir(), 'research-src-'));
});

afterEach(() => {
  t.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

function registry(
  responses: readonly DryRunResponse[],
  research: ResearchSettings = settings.research,
): JobRegistry {
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: dryRunTransport({ researcher: responses }),
  });
  return createJobRegistry([
    ingestJobHandler({ db: t.db, dataDir: t.dataDir }),
    researchJobHandler({
      db: t.db,
      dataDir: t.dataDir,
      llm,
      prompts,
      settings: { video: settings.video, research },
    }),
  ]);
}

async function runNext(reg: JobRegistry): Promise<void> {
  await runNextJob({
    db: t.db,
    registry: reg,
    workerId: 'test:1',
    signal: new AbortController().signal,
  });
}

/** Seeds the topic, ingests its sources, then runs the research job. */
async function research(reg: JobRegistry, files = RATE_LIMITER_SOURCE_FILES) {
  const { runId } = seedRunWithUploads(t.db, t.dataDir, RATE_LIMITER_TOPIC, files);
  await runNext(reg);
  expect(listRunJobs(t.db, runId)[0]!.status).toBe('done');
  const job = enqueueJob(t.db, { type: RESEARCH_JOB_TYPE, runId });
  await runNext(reg);
  return { runId, job: getJob(t.db, job.id)! };
}

function logs(runId: number) {
  return listEventsSince(t.db, { runId, afterId: 0, limit: 200 })
    .filter((e) => e.type === 'log')
    .map((e) => e.payload as { level: string; message: string });
}

/** The recorded notes with one fact made to carry a number no source states. */
function withUnsourcedNumber(): string {
  const notes = JSON.parse(recordedContent) as { facts: { statement: string }[] };
  notes.facts[0]!.statement += ' Each refill takes about 37 ms.';
  return JSON.stringify(notes);
}

describe('research job (rate-limiter fixture, dry run)', () => {
  it('writes schema-valid notes with no unsourced numbers, as the run’s gate 1 input', async () => {
    const { runId, job } = await research(registry(recorded));
    expect(job.status).toBe('done');

    const result = latestResearch(t.db, t.dataDir, runId)!;
    expect(ResearchNotesSchema.safeParse(result.notes).success).toBe(true);
    expect(researchNotesProblems(result.notes, citableChunks(result.input))).toEqual([]);
    expect(result.notes.numbers.length).toBeGreaterThan(10);
    expect(result.notes.plainSummary).not.toMatch(/\d/);
    expect(result.notes.analogies.length).toBeGreaterThan(0); // 1-2 by schema
    expect(result.notes.glossary.map((g) => g.term.toLowerCase())).toContain('token bucket');
    expect(result.step).toMatchObject({ stage: 'research', status: 'done', error: null });
    expect(result.input.omittedChunks).toEqual([]);
    expect(result.input.topic).toEqual({
      title: RATE_LIMITER_TOPIC.title,
      angle: RATE_LIMITER_TOPIC.notes,
    });
    expect(result.input.sources.map((s) => s.origin)).toEqual([
      'token-bucket-field-guide.md',
      'quotaflow-readme.md',
      'larkspur-checkout-incident.md',
    ]);

    // One call per recorded attempt: any recorded repairs replay too, and only the last passes.
    const calls = listRunLlmCalls(t.db, runId);
    expect(calls).toHaveLength(recorded.length);
    expect(calls.map((c) => c.error === null)).toEqual(
      recorded.map((_, i) => i === recorded.length - 1),
    );
    expect(calls[0]).toMatchObject({
      role: 'researcher',
      stepId: result.step.id,
      promptVersion: promptId('researcher'),
      preambleVersion: 'preamble@v1',
    });
    const prompt = readDataJson(t.dataDir, calls[0]!.promptPath) as {
      messages: { role: string; content: string }[];
    };
    expect(prompt.messages[0]!.content).toContain('## OUTPUT SHAPE');
    expect(prompt.messages[0]!.content).toContain('(explanation level: beginner)');
    expect(prompt.messages[1]!.content).toContain('"id": "source-3#chunk-2"');
    expect(prompt.messages[1]!.content).not.toContain('omittedChunks');
    const { facts, numbers } = result.notes;
    expect(logs(runId).at(-1)?.message).toMatch(
      new RegExp(`^Research notes: ${facts.length} facts, ${numbers.length} numbers`),
    );
  });

  it('repairs an unsourced number through the LLM client', async () => {
    const reg = registry([{ content: withUnsourcedNumber() }, recordedAnswer]);
    const { runId, job } = await research(reg);
    expect(job.status).toBe('done');

    const calls = listRunLlmCalls(t.db, runId);
    expect(calls.map((c) => c.error)).toEqual(['Invalid output: 1 issue(s)', null]);
    const repair = readDataJson(t.dataDir, calls[1]!.promptPath) as {
      messages: { content: string }[];
    };
    const cited = (JSON.parse(recordedContent) as { facts: { sourceChunkIds: string[] }[] })
      .facts[0]!.sourceChunkIds;
    expect(repair.messages.at(-1)!.content).toContain(
      `$.facts[0].statement: "37" is not in the cited chunks (${cited.join(', ')})`,
    );
    expect(logs(runId).map((l) => l.message)).toContainEqual(
      expect.stringContaining('researcher: invalid output (1 issue(s)); repair 1/2'),
    );
  });

  it('fails the step and the job when the notes are still invalid after every repair', async () => {
    const bad = { content: withUnsourcedNumber() };
    const { runId, job } = await research(registry([bad, bad, bad]));
    expect(job.status).toBe('failed');
    expect(job.error).toContain('researcher output is still invalid after 2 repair attempts');
    expect(latestResearch(t.db, t.dataDir, runId)).toBeUndefined();
    const step = getRunStep(t.db, listRunLlmCalls(t.db, runId)[0]!.stepId!)!;
    expect(step).toMatchObject({ status: 'failed' });
    expect(step.inputPath).not.toBeNull();
  });

  it('marks an interrupted earlier attempt failed and starts a new step', async () => {
    const { runId } = seedRunWithUploads(
      t.db,
      t.dataDir,
      RATE_LIMITER_TOPIC,
      RATE_LIMITER_SOURCE_FILES,
    );
    const stale = startRunStep(t.db, { runId, stage: 'research' });
    const reg = registry(recorded);
    await runNext(reg);
    enqueueJob(t.db, { type: RESEARCH_JOB_TYPE, runId });
    await runNext(reg);

    expect(getRunStep(t.db, stale.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Interrupted') as string,
    });
    expect(latestResearch(t.db, t.dataDir, runId)!.step.id).toBeGreaterThan(stale.id);
    expect(logs(runId).map((l) => l.level + ' ' + l.message)).toContainEqual(
      'warn An earlier research attempt was interrupted; starting a new one.',
    );
  });
});

describe('research job: source token budget', () => {
  it('selects chunks from an oversized source, records and logs what it left out', async () => {
    const oversized = join(scratch, 'platform-team-notes.md');
    writeFileSync(oversized, buildOversizedSource());
    const reg = registry(recorded, { sourceTokenBudget: 4_000 });
    const { runId, job } = await research(reg, [...RATE_LIMITER_SOURCE_FILES, oversized]);
    expect(job.status).toBe('done');

    const { input, step } = latestResearch(t.db, t.dataDir, runId)!;
    expect(input.budget.tokens).toBe(4_000);
    expect(input.budget.sourceTokens).toBeGreaterThan(8_000);
    expect(input.budget.keptTokens).toBeLessThanOrEqual(4_000);

    const [guide, readme, incident, notes] = input.sources;
    // The small sources fit their share and keep everything.
    expect([guide, readme, incident].map((s) => s!.chunks.length)).toEqual([2, 2, 2]);
    // The oversized one keeps its first chunks and every relevant one, in original order;
    // what it leaves out is filler.
    const kept = notes!.chunks.map((c) => Number(c.id.split('#chunk-')[1]));
    expect(kept.slice(0, 2)).toEqual([1, 2]);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    const all = SourceChunksFileSchema.parse(
      readDataJson(
        t.dataDir,
        sourceChunksPath(getRun(t.db, runId)!.topicId, notes!.sourceId, notes!.contentHash),
      ),
    ).chunks;
    const relevant = all.filter((c) => c.text.includes(RELEVANT_MARKER)).map((c) => c.id);
    expect(relevant.length).toBeGreaterThan(0);
    const keptIds = new Set(notes!.chunks.map((c) => c.id));
    for (const id of relevant) expect(keptIds.has(id)).toBe(true);

    // Every chunk is either sent or recorded as left out, never both.
    const sent = new Set(citableChunks(input).map((c) => c.id));
    expect(input.omittedChunks.length).toBeGreaterThan(10);
    for (const o of input.omittedChunks) {
      expect(o.sourceId).toBe(notes!.sourceId);
      expect(sent.has(o.id)).toBe(false);
    }
    const prompt = readDataText(t.dataDir, listRunLlmCalls(t.db, runId)[0]!.promptPath);
    expect(prompt).not.toContain(input.omittedChunks[0]!.id);
    expect(step.inputPath).toMatch(/research\/input-\d+\.json$/);

    expect(logs(runId)).toContainEqual({
      level: 'warn',
      message: expect.stringMatching(
        new RegExp(
          `^Source budget 4,000 tokens: sent \\d+ of \\d+ chunks .*left out ${input.omittedChunks.length} \\(source 4: ${input.omittedChunks.length}\\)\\.$`,
        ),
      ) as string,
    });
  });
});
