/**
 * `pnpm --filter @explainer-studio/studio research:fixture [--record]`: runs source ingestion
 * and the Researcher on the invented rate-limiter sources against the configured model (needs
 * DEEPSEEK_API_KEY), in a scratch data dir with its own database:
 * <DATA_DIR>/research/fixture/rate-limiter/ (wiped first; the studio DB is not touched).
 * Prints the job log, the deterministic check result and the cost, and leaves the step's
 * input, notes and LLM call files there for review.
 * With --record, the run's Researcher responses (every attempt, repairs included) replace the
 * dry-run fixture that `research.test.ts` replays. Review the diff before committing.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { researchNotesProblems } from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { resolveDataPath } from '#core/data-files.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls, runCostUsd } from '#core/db/repositories/llm-calls.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { citableChunks } from '#worker/agents/researcher/input.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '#worker/agents/researcher/testing.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import { createLlmClient, createLlmTransport, type DryRunResponse } from '#worker/llm/index.ts';
import { runNextJob } from '#worker/runner.ts';

function registryFor(config: AppConfig, db: Db, dataDir: string): JobRegistry {
  const llm = createLlmClient({
    db,
    dataDir,
    llm: config.llm,
    transport: createLlmTransport(config.llm),
  });
  return createJobRegistry([
    ingestJobHandler({ db, dataDir }),
    researchJobHandler({
      db,
      dataDir,
      llm,
      prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
      settings: { video: config.video, research: config.research },
    }),
  ]);
}

async function runJob(db: Db, registry: JobRegistry, jobId: number): Promise<boolean> {
  await runNextJob({
    db,
    registry,
    workerId: 'research-fixture',
    signal: new AbortController().signal,
  });
  const job = getJob(db, jobId);
  if (job?.status === 'done') return true;
  console.error(`  ${job?.type ?? 'job'} ${job?.status ?? 'missing'}: ${job?.error ?? ''}`);
  return false;
}

function printLog(db: Db, runId: number): void {
  for (const event of listEventsSince(db, { runId, afterId: 0, limit: 1_000 })) {
    if (event.type !== 'log') continue;
    const { level, message } = event.payload as { level: string; message: string };
    console.log(`  [${level}] ${message}`);
  }
}

/** The response file the LLM client writes next to each call's prompt. */
interface RecordedResponseFile {
  readonly content: string | null;
  readonly servedModel: string | null;
  readonly finishReason: string | null;
  readonly usage: DryRunResponse['usage'];
}

/** The run's Researcher responses in call order, as `loadDryRunFixtures` reads them. */
function recordResponses(db: Db, dataDir: string, runId: number): number {
  const responses: DryRunResponse[] = listRunLlmCalls(db, runId)
    .filter((call) => call.role === 'researcher' && call.responsePath)
    .map((call) => {
      const file = JSON.parse(
        readFileSync(resolveDataPath(dataDir, call.responsePath!), 'utf8'),
      ) as RecordedResponseFile;
      // Reasoning text is left out: replay never reads it, and it is large.
      return {
        content: file.content,
        servedModel: file.servedModel ?? 'recorded',
        finishReason: file.finishReason ?? 'stop',
        usage: file.usage ?? null,
      };
    });
  mkdirSync(RATE_LIMITER_RESPONSES_DIR, { recursive: true });
  writeFileSync(
    join(RATE_LIMITER_RESPONSES_DIR, 'researcher.json'),
    `${JSON.stringify(responses, null, 2)}\n`,
  );
  return responses.length;
}

async function main(): Promise<number> {
  const config = loadConfig();
  const record = process.argv.includes('--record');
  const dataDir = join(config.dataDir, 'research', 'fixture', 'rate-limiter');
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const registry = registryFor(config, db, dataDir);
    const seeded = seedRunWithUploads(db, dataDir, RATE_LIMITER_TOPIC, RATE_LIMITER_SOURCE_FILES);
    console.log(
      `rate-limiter fixture: ${seeded.sourceIds.length} sources, model ${config.llm.models.researcher}`,
    );
    const ingestJob = listRunJobs(db, seeded.runId)[0]!.id;
    const ingested = await runJob(db, registry, ingestJob);
    const researchJob = ingested
      ? enqueueJob(db, { type: RESEARCH_JOB_TYPE, runId: seeded.runId }).id
      : null;
    const researched = researchJob !== null && (await runJob(db, registry, researchJob));
    printLog(db, seeded.runId);
    console.log(`  cost: $${runCostUsd(db, seeded.runId).toFixed(4)}; files -> ${shown(dataDir)}`);
    if (!researched) return 1;

    const result = latestResearch(db, dataDir, seeded.runId)!;
    const problems = researchNotesProblems(result.notes, citableChunks(result.input));
    console.log(`  checks: ${problems.length === 0 ? 'pass' : `${problems.length} problem(s)`}`);
    for (const p of problems) console.log(`    ${p.path} ${p.code}: ${p.message}`);
    if (record) {
      const n = recordResponses(db, dataDir, seeded.runId);
      console.log(
        `  recorded ${n} response(s) -> ${shown(RATE_LIMITER_RESPONSES_DIR)}/researcher.json`,
      );
    }
    return problems.length === 0 ? 0 : 1;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
