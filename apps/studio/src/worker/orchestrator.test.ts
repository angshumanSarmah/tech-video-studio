import { join } from 'node:path';
import { PIPELINE_STEP_IDS, SettingsSchema, type EventDto } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Executor } from '#core/db/client.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { listRunExports } from '#core/db/repositories/exports.ts';
import { listRunBacklog } from '#core/db/repositories/backlog.ts';
import { writeDataJson } from '#core/data-files.ts';
import { decideGate, getGate, listRunGates } from '#core/db/repositories/gates.ts';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import {
  getRun,
  listPartRuns,
  setActiveRunStatus,
  setPipelineStep,
  type Run,
} from '#core/db/repositories/runs.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { advanceRun, sweepRuns } from '#core/orchestrator/advance.ts';
import { PIPELINE } from '#core/orchestrator/pipeline.ts';
import { readRunSnapshot } from '#core/orchestrator/snapshot.ts';
import { latestDirection } from '#core/services/direction.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { curateRound, reviewOf, type CurateRound } from './agents/curator/testing.ts';
import {
  FIXTURE_TOPIC_IDS,
  fixtureResponsesDir,
  fixtureRunSettings,
  fixtureTopic,
  type FixtureTopicId,
} from './agents/fixture-topics.ts';
import { fixtureGeneratedSpec } from './agents/generator/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from './agents/prompts/templates.ts';
import { seedRunWithUploads } from './agents/researcher/testing.ts';
import { createJobHandlers, createJobRegistry, type JobRegistry } from './jobs/registry.ts';
import { createLlmClient } from './llm/client.ts';
import {
  dryRunTransport,
  loadDryRunFixtures,
  recordedInOrder,
  type DryRunResponse,
} from './llm/dry-run.ts';
import { workerTransport } from './llm/index.ts';
import { fakeTools } from './render/testing.ts';
import { fixtureTts } from './repair/testing.ts';
import { runNextJob } from './runner.ts';

/**
 * P1C.9 step 3's acceptance (the design doc's acceptance 1): a dry-run run of each fixture topic from
 * topic to the end with every gate on auto, through the real job handlers and the orchestrator.
 * The recorded Researcher, Director, Scriptwriter and Generator answers, and the topic's recorded
 * Curator round (`curateRound`: the review, its repairs and the second review), so gate 3 passes
 * with the real Curator; the committed Kokoro timing (`fixtureTts`); a fake renderer. The other
 * tests here use a Curator that flags nothing (`reviewOf`).
 */

const TOPIC = 'tokenizer';
const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const AUTO = { research: true, beat_sheet: true, scenes: true, draft: true };

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

/**
 * The worker's handlers with the recorded answers. The Curator: a recorded review-plus-repair
 * round (`round`, after which the recorded Scriptwriter and Generator answers go on with the
 * round's repairs), else a review that flags nothing.
 */
function worker(round?: CurateRound, topic: FixtureTopicId = TOPIC): JobRegistry {
  const recorded = (role: 'researcher' | 'director' | 'scriptwriter') =>
    recordedInOrder(fixtureResponsesDir(role, topic), role);
  const boards = loadDryRunFixtures(fixtureResponsesDir('generator', topic)).generator as Record<
    string,
    DryRunResponse[]
  >;
  const generator = Object.fromEntries(
    Object.entries(boards).map(([beat, list]) => [
      beat,
      [...list, ...(round?.generator[beat] ?? [])],
    ]),
  );
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: SettingsSchema.parse({}).llm,
    transport: dryRunTransport({
      researcher: recorded('researcher'),
      director: recorded('director'),
      scriptwriter: [...recorded('scriptwriter'), ...(round?.scriptwriter ?? [])],
      generator,
      curator: round?.curator ?? reviewOf(fixtureGeneratedSpec(topic)),
    }),
  });
  const tts = fixtureTts(topic, join(t.dataDir, 'fake-tts')).provider;
  const { tools } = fakeTools();
  return createJobRegistry(
    createJobHandlers({ db: t.db, dataDir: t.dataDir, tools, tts, llm, prompts }),
  );
}

/** Runs jobs as the worker does (the orchestrator queues each next one) until none is left. */
async function drain(registry: JobRegistry): Promise<void> {
  const signal = new AbortController().signal;
  const advance = (tx: Executor, runId: number) => advanceRun(tx, t.dataDir, runId);
  while (await runNextJob({ db: t.db, registry, workerId: 't', signal, advance })) {
    // the orchestrator queued the next job, if any
  }
}

function startTopic(id: FixtureTopicId = TOPIC): number {
  const { topic, sourceFiles, seriesTag } = fixtureTopic(id);
  return seedRunWithUploads(t.db, t.dataDir, topic, sourceFiles, {
    seriesTag,
    settings: fixtureRunSettings({ autoApprove: AUTO }),
  }).runId;
}

/** The run's events as `<type> <what>` lines: the stage sequence and every decision. */
function eventLines(events: readonly EventDto[]): string[] {
  return events.flatMap((e) => {
    switch (e.type) {
      case 'run_status':
        return [`run ${e.payload.status} ${e.payload.step ?? ''}`.trim()];
      case 'gate':
        return [`gate ${e.payload.gate} ${e.payload.status} ${e.payload.decidedBy ?? ''}`.trim()];
      case 'job_status':
        return [`job ${e.jobId} ${e.payload.status}`];
      default:
        return [];
    }
  });
}

describe.each(FIXTURE_TOPIC_IDS)('the orchestrator, dry run: %s', (topicId) => {
  it('takes a run from topic to the end with every gate on auto, the real Curator included', async () => {
    const runId = startTopic(topicId);
    await drain(worker(curateRound(topicId), topicId));

    const run = getRun(t.db, runId)!;
    const events = listEventsSince(t.db, { runId, afterId: 0, limit: 5_000 }).map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })) as EventDto[];
    const problems = events.filter((e) => e.type === 'log' && e.payload.level !== 'info');
    expect(run.status, JSON.stringify(problems, null, 2)).toBe('done');

    const steps = events.flatMap((e) =>
      e.type === 'run_status' && e.payload.step ? [e.payload.step] : [],
    );
    expect([...new Set(steps)]).toEqual([
      'ingest',
      'research',
      'gate_research',
      'direct',
      'gate_beat_sheet',
      'split',
      'script',
      'spec',
      'tts',
      'generate',
      'board_backlog',
      'retime',
      'curate',
      'stills',
      'gate_scenes',
      'draft',
      'gate_draft',
      'final',
      'done',
    ]);
    expect(listRunJobs(t.db, runId).map((j) => [j.type, j.status])).toEqual([
      ['ingest', 'done'],
      ['research', 'done'],
      ['direct', 'done'],
      ['script', 'done'],
      ['tts', 'done'],
      ['generate', 'done'],
      ['tts', 'done'],
      ['curate', 'done'],
      ['render_stills', 'done'],
      ['render_draft', 'done'],
      ['render_final', 'done'],
    ]);

    const gates = listRunGates(t.db, runId);
    expect(gates.map((g) => [g.gate, g.status, g.decidedBy])).toEqual([
      ['research', 'approved', 'auto'],
      ['beat_sheet', 'approved', 'auto'],
      ['scenes', 'approved', 'auto'],
      ['draft', 'approved', 'auto'],
    ]);
    const scenes = gates.find((g) => g.gate === 'scenes')!;
    expect(scenes.specVersionId).toBe(getLatestSpecVersion(t.db, runId)!.id);
    expect(gates.find((g) => g.gate === 'draft')!.specVersionId).toBe(scenes.specVersionId);
    expect(gates.find((g) => g.gate === 'research')!.subjectStepId).not.toBeNull();
    expect(listRunExports(t.db, runId)).toHaveLength(1);

    expect(eventLines(events).filter((line) => !line.startsWith('job '))).toEqual([
      'run queued ingest',
      'run running ingest',
      'run running research',
      'run running gate_research',
      'gate research pending',
      'gate research approved auto',
      'run running direct',
      'run running gate_beat_sheet',
      'gate beat_sheet pending',
      'gate beat_sheet approved auto',
      'run running split',
      'run running script',
      'run running spec',
      'run running tts',
      'run running generate',
      'run running board_backlog',
      'run running retime',
      'run running curate',
      'run running stills',
      'run running gate_scenes',
      'gate scenes pending',
      'gate scenes approved auto',
      'run running draft',
      'run running gate_draft',
      'gate draft pending',
      'gate draft approved auto',
      'run running final',
      'run running done',
      'run done done',
    ]);
  });
});

/** Starts the tokenizer with only these gates on auto and runs it until it has to wait. */
async function runUntilWaiting(autoApprove: Partial<typeof AUTO>): Promise<number> {
  const { topic, sourceFiles, seriesTag } = fixtureTopic(TOPIC);
  const { runId } = seedRunWithUploads(t.db, t.dataDir, topic, sourceFiles, {
    seriesTag,
    settings: fixtureRunSettings({ autoApprove }),
  });
  await drain(worker());
  return runId;
}

/** A user's approval of a pending gate, then the orchestrator, in one transaction (as step 4's API). */
function approveByUser(runId: number, gate: 'beat_sheet' | 'scenes'): void {
  t.db.transaction((tx) => {
    decideGate(tx, runId, gate, { status: 'approved', decidedBy: 'user' });
    advanceRun(tx, t.dataDir, runId);
  });
}

const jobTypes = (runId: number) => listRunJobs(t.db, runId).map((j) => j.type);

describe('the orchestrator: gates that wait', () => {
  it('stops at the beat sheet, goes on once it is approved, and stops again at the scenes', async () => {
    const runId = await runUntilWaiting({ research: true });
    expect(getRun(t.db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_beat_sheet',
    });
    expect(jobTypes(runId)).toEqual(['ingest', 'research', 'direct']);
    expect(getGate(t.db, runId, 'beat_sheet')).toMatchObject({ status: 'pending' });

    approveByUser(runId, 'beat_sheet');
    expect(getRun(t.db, runId)).toMatchObject({ status: 'running', pipelineStep: 'script' });
    await drain(worker());
    expect(getRun(t.db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_scenes',
    });
    // Stills are ready before the scenes gate, and nothing renders past it.
    expect(jobTypes(runId).slice(-2)).toEqual(['curate', 'render_stills']);
    expect(getGate(t.db, runId, 'beat_sheet')).toMatchObject({
      status: 'approved',
      decidedBy: 'user',
    });
  });
});

describe('the orchestrator: parts', () => {
  /** The recorded plan with two parts and a missing-primitive request, at the beat-sheet gate. */
  async function atBeatSheetWithParts(): Promise<number> {
    const runId = await runUntilWaiting({ research: true });
    const direction = latestDirection(t.db, t.dataDir, runId)!;
    const plan = structuredClone(direction.plan);
    delete plan.meta.targetLengthSec;
    plan.parts = [
      {
        part: 1,
        title: '<example-part-1>',
        mainIdea: '<example-idea-1>',
        beatIds: ['b1', 'b2', 'b3'],
        targetLengthSec: 32,
      },
      {
        part: 2,
        title: '<example-part-2>',
        mainIdea: '<example-idea-2>',
        beatIds: ['b4', 'b5', 'b6', 'b7'],
        targetLengthSec: 43,
      },
    ];
    plan.story.missingPrimitiveRequests = [
      {
        name: '<example-primitive>',
        description: '<example-description>',
        fallbackUsed: 'node_card',
      },
    ];
    writeDataJson(t.dataDir, direction.step.outputPath!, plan);
    return runId;
  }

  it('splits into part runs at the beat sheet; part 2 waits for part 1; the parent waits for both', async () => {
    const parentId = await atBeatSheetWithParts();
    approveByUser(parentId, 'beat_sheet');

    expect(getRun(t.db, parentId)).toMatchObject({ status: 'running', pipelineStep: 'children' });
    expect(listRunBacklog(t.db, parentId).map((b) => b.name)).toEqual(['<example-primitive>']);
    const parts = listPartRuns(t.db, parentId);
    expect(parts.map((p) => [p.partIndex, p.partCount, p.pipelineStep])).toEqual([
      [1, 2, 'script'],
      [2, 2, 'script'],
    ]);
    const [one, two] = parts as [Run, Run];
    expect(two.resolvedSettings).toEqual(getRun(t.db, parentId)!.resolvedSettings);
    // Each part reads its own plan (and the parent's research step).
    const partPlans = parts.map((p) => latestDirection(t.db, t.dataDir, p.id)!);
    expect(partPlans.map((d) => d.plan.story.beats.map((b) => b.id))).toEqual([
      ['b1', 'b2', 'b3'],
      ['b4', 'b5', 'b6', 'b7'],
    ]);
    expect(partPlans[0]!.plan.story.ending.kind).toBe('cliffhanger_ending');
    expect(partPlans[1]!.input.researchStepId).toBe(
      latestDirection(t.db, t.dataDir, parentId)!.input.researchStepId,
    );
    // Part 1 writes its script; part 2 waits for it.
    expect(jobTypes(one.id)).toEqual(['script']);
    expect(jobTypes(two.id)).toEqual([]);
    expect(readRunSnapshot(t.db, t.dataDir, two.id).part).toEqual({
      index: 2,
      previousReady: false,
    });
    setPipelineStep(t.db, one.id, 'tts', null);
    expect(readRunSnapshot(t.db, t.dataDir, two.id).part?.previousReady).toBe(true);

    // The parent finishes when both parts have.
    t.db.transaction((tx) => {
      setActiveRunStatus(tx, one.id, 'done');
      advanceRun(tx, t.dataDir, one.id);
    });
    expect(getRun(t.db, parentId)!.status).toBe('running');
    t.db.transaction((tx) => {
      setActiveRunStatus(tx, two.id, 'done');
      advanceRun(tx, t.dataDir, two.id);
    });
    expect(getRun(t.db, parentId)).toMatchObject({ status: 'done', pipelineStep: 'done' });
  });
});

describe('the orchestrator: startup sweep', () => {
  it('moves on a run whose job finished without advancing it (an older worker, a crash)', async () => {
    const { topic, sourceFiles, seriesTag } = fixtureTopic(TOPIC);
    const { runId } = seedRunWithUploads(t.db, t.dataDir, topic, sourceFiles, {
      seriesTag,
      settings: fixtureRunSettings({ autoApprove: AUTO }),
    });
    const signal = new AbortController().signal;
    await runNextJob({ db: t.db, registry: worker(), workerId: 't', signal });
    expect(jobTypes(runId)).toEqual(['ingest']);
    expect(getRun(t.db, runId)).toMatchObject({ status: 'running', pipelineStep: 'ingest' });

    expect(sweepRuns(t.db, t.dataDir)).toEqual([runId]);
    expect(jobTypes(runId)).toEqual(['ingest', 'research']);
    expect(sweepRuns(t.db, t.dataDir)).toEqual([]);
  });
});

describe('the orchestrator: a state it cannot work from', () => {
  it('fails the run with the reason logged, instead of throwing in the worker', async () => {
    const runId = await runUntilWaiting({ research: true });
    // At tts with no spec version: there is nothing to narrate.
    t.db.transaction((tx) => {
      setPipelineStep(tx, runId, 'tts', null);
      setActiveRunStatus(tx, runId, 'running');
      advanceRun(tx, t.dataDir, runId);
    });
    expect(getRun(t.db, runId)!.status).toBe('failed');
    const logs = listEventsSince(t.db, { runId, afterId: 0, limit: 500 }).filter(
      (e) => e.type === 'log',
    );
    expect(logs.at(-1)?.payload).toEqual({
      level: 'error',
      message: `Run ${runId} has no spec version.`,
    });
  });
});

describe('the pipeline table', () => {
  it('names only job types the worker runs', () => {
    const registry = worker();
    const missing = PIPELINE_STEP_IDS.flatMap((id) => {
      const step = PIPELINE[id];
      return step.kind === 'job' && !registry.get(step.jobType) ? [step.jobType] : [];
    });
    expect(missing).toEqual([]);
  });
});

describe('workerTransport', () => {
  const llm = SettingsSchema.parse({}).llm;

  it('replays recorded answers when LLM_DRY_RUN_DIR is set', async () => {
    const dir = fixtureResponsesDir('researcher', TOPIC);
    const { transport, dryRun } = workerTransport({ llm, llmDryRunDir: dir });
    expect(dryRun).toBe(true);
    const response = await transport.send({
      role: 'researcher',
      model: llm.models.researcher,
      messages: [],
      signal: new AbortController().signal,
    });
    expect(response.content).toBe(recordedInOrder(dir, 'researcher')[0]!.content);
  });

  it('calls the API otherwise', () => {
    expect(workerTransport({ llm, llmDryRunDir: null }).dryRun).toBe(false);
  });
});
