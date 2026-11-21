/**
 * `pnpm --filter @explainer-studio/studio research:fixture [--topic <topic>] [--level <level>]
 * [--record [--max-repairs <n>]]`: runs source ingestion and the Researcher on a fixture topic's invented sources
 * (`rate-limiter`, the default, or `tokenizer`) against the configured model (needs
 * DEEPSEEK_API_KEY), in a scratch data dir with its own database:
 * <DATA_DIR>/research/fixture/<topic>/ (wiped first; the studio DB is not touched).
 * `--level` sets the run's explanation level (beginner | intermediate | expert; default: the
 * app's `settings.video`). Prints the job log, each attempt with its repair issues, the plain
 * summary and glossary terms, the deterministic check result and the cost, and leaves the step's
 * input, notes and LLM call files there for review.
 * With --record, the run's Researcher responses (every attempt, repairs included) replace the
 * topic's dry-run fixture that `research.test.ts` replays. Review the diff before committing.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { researchNotesProblems, type ResearchNotes } from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { fixtureResponsesDir } from '#worker/agents/fixture-topics.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { citableChunks } from '#worker/agents/researcher/input.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import { createLlmClient, createLlmTransport } from '#worker/llm/index.ts';
import {
  levelArg,
  printLiveRoles,
  printLog,
  recordResponses,
  roleCalls,
  runJob as runAgentJob,
  seedFixtureRun,
  shouldRecord,
  topicArg,
} from './agent-fixture.ts';

const runJob = (db: Db, registry: JobRegistry, jobId: number) =>
  runAgentJob(db, registry, jobId, 'research-fixture');

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

function printNotes(notes: ResearchNotes): void {
  console.log(`  plain summary: ${notes.plainSummary}`);
  console.log(`  glossary: ${notes.glossary.map((g) => g.term).join(', ')}`);
  for (const a of notes.analogies) console.log(`  analogy: ${a.analogy} (breaks: ${a.breaksDown})`);
  console.log(
    `  numbers: ${notes.numbers.length}, facts: ${notes.facts.length}, ` +
      `incidents: ${notes.failureModes.filter((f) => f.kind === 'incident').length}`,
  );
}

async function main(): Promise<number> {
  const config = loadConfig();
  const topic = topicArg(process.argv);
  const level = levelArg(process.argv);
  const dataDir = join(config.dataDir, 'research', 'fixture', topic.id);
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const registry = registryFor(config, db, dataDir);
    const seeded = seedFixtureRun(db, dataDir, topic, level);
    console.log(
      `${topic.id} fixture: ${seeded.sourceIds.length} sources, model ${config.llm.models.researcher}, level ${level ?? config.video.explanationLevel}`,
    );
    const ingested = await runJob(db, registry, listRunJobs(db, seeded.runId)[0]!.id);
    const job = ingested ? enqueueJob(db, { type: RESEARCH_JOB_TYPE, runId: seeded.runId }) : null;
    const researched = job !== null && (await runJob(db, registry, job.id));
    printLog(db, seeded.runId);
    printLiveRoles(db, dataDir, seeded.runId, ['researcher']);
    console.log(`  files -> ${shown(dataDir)}`);
    if (!researched) return 1;

    const result = latestResearch(db, dataDir, seeded.runId)!;
    printNotes(result.notes);
    const problems = researchNotesProblems(result.notes, citableChunks(result.input));
    console.log(`  checks: ${problems.length === 0 ? 'pass' : `${problems.length} problem(s)`}`);
    for (const p of problems) console.log(`    ${p.path} ${p.code}: ${p.message}`);
    const repairs = roleCalls(db, seeded.runId, 'researcher').length - 1;
    if (problems.length === 0 && shouldRecord(process.argv, repairs)) {
      const dir = fixtureResponsesDir('researcher', topic.id);
      const n = recordResponses(
        dataDir,
        roleCalls(db, seeded.runId, 'researcher'),
        dir,
        'researcher',
      );
      console.log(`  recorded ${n} response(s) -> ${shown(dir)}/researcher.json`);
    }
    return problems.length === 0 ? 0 : 1;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
