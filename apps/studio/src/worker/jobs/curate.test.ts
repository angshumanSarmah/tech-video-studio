import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsSchema, type CuratorIssue } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enqueueJob, getJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestCuration } from '#core/services/curation.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import {
  CURATOR_SEEDS,
  evalPath,
  evaluateTopic,
  seedCatcher,
  seededSpec,
  TOPIC_EXPECTATIONS,
  type CuratorSeed,
} from '../agents/curator/fixtures.ts';
import {
  curatorResponsesDir,
  queueFixtureCurate,
  recordedChain,
} from '../agents/curator/testing.ts';
import {
  FIXTURE_TOPIC_IDS,
  fixtureRunSettings,
  fixtureTopic,
  type FixtureTopicId,
} from '../agents/fixture-topics.ts';
import { fixtureGeneratedSpec } from '../agents/generator/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import { seedRunWithUploads } from '../agents/researcher/testing.ts';
import { createLlmClient } from '../llm/client.ts';
import { dryRunTransport, type DryRunFixtures, type DryRunResponse } from '../llm/dry-run.ts';
import { runNextJob } from '../runner.ts';
import { CURATE_JOB_TYPE, curateJobHandler } from './curate.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from './direct.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry, type JobRegistry } from './registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './research.ts';

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

function registry(fixtures: DryRunFixtures): JobRegistry {
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: dryRunTransport(fixtures),
  });
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    curateJobHandler(deps),
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

/** A fixture topic's run with its research and plan replayed, ready for a spec version. */
async function plannedRun(topic: FixtureTopicId, reg: JobRegistry): Promise<number> {
  const { topic: details, sourceFiles, seriesTag } = fixtureTopic(topic);
  const { runId } = seedRunWithUploads(t.db, t.dataDir, details, sourceFiles, {
    seriesTag,
    settings: fixtureRunSettings(),
  });
  await runNext(reg);
  for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
    enqueueJob(t.db, { type, runId });
    await runNext(reg);
  }
  return runId;
}

async function curateFixture(topic: FixtureTopicId, seed?: CuratorSeed) {
  const reg = registry(recordedChain(topic, curatorResponsesDir(topic, seed)));
  const runId = await plannedRun(topic, reg);
  const jobId = queueFixtureCurate(t.db, t.dataDir, runId, topic, seed);
  await runNext(reg);
  const job = getJob(t.db, jobId)!;
  expect(job.status, job.error ?? '').toBe('done');
  return { runId, curation: latestCuration(t.db, t.dataDir, runId)! };
}

const recordedEval = (dir: string): unknown => JSON.parse(readFileSync(evalPath(dir), 'utf8'));

describe('curate job: the recorded reviews', () => {
  it.each(FIXTURE_TOPIC_IDS)('%s replays to the recorded eval', async (topic) => {
    const { runId, curation } = await curateFixture(topic);
    const review = curation.report.review!;
    expect(evaluateTopic(review.issues, TOPIC_EXPECTATIONS[topic])).toEqual(
      recordedEval(curatorResponsesDir(topic)),
    );
    expect(review.usage.calls).toBe(
      listRunLlmCalls(t.db, runId).filter((c) => c.role === 'curator').length,
    );
    expect(curation.input.specVersionId).toBe(curation.report.specVersionId);
  });

  it.each(CURATOR_SEEDS.map((s) => [s.id, s] as const))(
    'seed %s replays to the recorded verdict',
    async (_, seed) => {
      const { curation } = await curateFixture(seed.topic, seed);
      const { review, codeIssues } = curation.report;
      const spec = seededSpec(fixtureGeneratedSpec(seed.topic), seed);
      const by = seedCatcher(review!.issues, codeIssues, spec, seed);
      expect({ seed: seed.id, caught: by !== null, by }).toEqual(
        recordedEval(curatorResponsesDir(seed.topic, seed)),
      );
    },
  );
});

describe('curate job', () => {
  const unverified: CuratorIssue = {
    beatId: 'beat5',
    category: 'visual_contradicts',
    severity: 'blocking',
    owner: 'generator',
    fields: ['board'],
    evidence: [{ kind: 'label', elementId: 'latency', quote: 'slowest request' }],
    problem: '<example-problem>',
    fix: '<example-fix>',
  };
  const answer = (issues: CuratorIssue[]): DryRunResponse => ({
    content: JSON.stringify({ issues }),
    servedModel: 'recorded',
    finishReason: 'stop',
    usage: null,
  });

  it('drops issues still unverified after the repairs, records coverage left out, and finishes', async () => {
    const chain = recordedChain('rate-limiter', curatorResponsesDir('rate-limiter'));
    const audit: DryRunResponse = {
      ...answer([]),
      content: JSON.stringify({ claims: [], issues: [] }),
    };
    const curator = [
      audit,
      audit,
      audit,
      answer([unverified]),
      answer([unverified]),
      answer([unverified]),
    ];
    const reg = registry({ ...chain, curator });
    const runId = await plannedRun('rate-limiter', reg);
    queueFixtureCurate(t.db, t.dataDir, runId, 'rate-limiter');
    await runNext(reg);
    const review = latestCuration(t.db, t.dataDir, runId)!.report.review!;
    expect(review.issues).toEqual([]);
    expect(review.dropped.map((d) => [d.why, d.reasons.map((r) => r.code)])).toEqual([
      ['unverified', ['quote_not_found']],
    ]);
    expect(review.calls).toEqual({ claims: 3, story: 3 });
    // Two repair turns asked for the left-out sentences; the last answer still left them out.
    expect(review.coverage.repairs).toBe(2);
    expect(review.coverage.missing.length).toBeGreaterThan(0);
    expect(review.coverage.missing[0]).toContain("beat1's sentence");
  });

  it('reports an invalid spec with its errors and no review', async () => {
    const chain = recordedChain('rate-limiter', curatorResponsesDir('rate-limiter'));
    const reg = registry({ ...chain, curator: [] });
    const runId = await plannedRun('rate-limiter', reg);
    const spec = structuredClone(fixtureGeneratedSpec('rate-limiter'));
    spec.scenes[0]!.events[0]!.at = { type: 'word', index: 999 };
    const saved = saveSpecVersion(t.db, t.dataDir, { runId, spec, createdBy: 'user' });
    enqueueJob(t.db, {
      type: CURATE_JOB_TYPE,
      runId,
      payload: { specVersionId: saved.version.id },
    });
    await runNext(reg);
    const { report } = latestCuration(t.db, t.dataDir, runId)!;
    expect(report.review).toBeNull();
    expect(report.codeIssues.map((i) => i.code)).toEqual(['anchor_out_of_range']);
    expect(report.blocking).toBe(true);
    expect(listRunJobs(t.db, runId).at(-1)?.status).toBe('done');
  });
});
