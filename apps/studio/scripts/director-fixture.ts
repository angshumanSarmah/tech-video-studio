/**
 * `pnpm --filter @explainer-studio/studio director:fixture [--topic <topic>] [--level <level>]
 * [--record [--max-repairs <n>]]`: runs the Director on a fixture topic (`rate-limiter`, the default, or
 * `tokenizer`) against the configured model (needs DEEPSEEK_API_KEY), in a scratch data dir with
 * its own database: <DATA_DIR>/director/fixture/<topic>/ (wiped first; the studio DB is not
 * touched). The sources are ingested, then the Researcher replays its recorded answer for the
 * topic, or runs live when the topic has none. `--level` sets the run's explanation level
 * (default: the app's `settings.video`). Prints the job log, each live role's attempts with their
 * repair issues and cost, and the plan (hook, running example, beats with devices and patterns,
 * ending); the step files stay there. With --record, the run's Director responses (every
 * attempt, repairs included) replace the topic's dry-run fixture (only the Director's). Review
 * the diff before committing.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { latestDirection } from '#core/services/direction.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { fixtureResponsesDir } from '#worker/agents/fixture-topics.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import { createLlmClient, type LlmTransport } from '#worker/llm/index.ts';
import {
  chainTransport,
  levelArg,
  printLiveRoles,
  printLog,
  printPlan,
  recordResponses,
  roleCalls,
  runJob as runAgentJob,
  seedFixtureRun,
  shouldRecord,
  topicArg,
} from './agent-fixture.ts';

const runJob = (db: Db, registry: JobRegistry, jobId: number) =>
  runAgentJob(db, registry, jobId, 'director-fixture');

function registryFor(
  config: AppConfig,
  db: Db,
  dataDir: string,
  transport: LlmTransport,
): JobRegistry {
  const llm = createLlmClient({ db, dataDir, llm: config.llm, transport });
  const deps = {
    db,
    dataDir,
    llm,
    prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
    settings: { video: config.video, research: config.research },
  };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
  ]);
}

/** Ingest and research (replayed or live); false when a step failed. */
async function prepareRun(db: Db, registry: JobRegistry, runId: number) {
  const ingested = await runJob(db, registry, listRunJobs(db, runId)[0]!.id);
  const research = ingested && enqueueJob(db, { type: RESEARCH_JOB_TYPE, runId });
  return Boolean(research && (await runJob(db, registry, research.id)));
}

async function main(): Promise<number> {
  const config = loadConfig();
  const topic = topicArg(process.argv);
  const level = levelArg(process.argv);
  const dataDir = join(config.dataDir, 'director', 'fixture', topic.id);
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const chain = chainTransport(config, topic.id, 'director');
    const registry = registryFor(config, db, dataDir, chain.transport);
    console.log(
      `${topic.id} fixture: model ${config.llm.models.director}, level ${level ?? config.video.explanationLevel}, live: ${chain.live.join(', ')}`,
    );
    const { runId } = seedFixtureRun(db, dataDir, topic, level, config);
    const ready = await prepareRun(db, registry, runId);
    const directed =
      ready && (await runJob(db, registry, enqueueJob(db, { type: DIRECT_JOB_TYPE, runId }).id));
    printLog(db, runId);
    printLiveRoles(db, dataDir, runId, chain.live);
    console.log(`  files -> ${shown(dataDir)}`);
    if (!directed) return 1;

    const { plan } = latestDirection(db, dataDir, runId)!;
    printPlan(plan, latestResearch(db, dataDir, runId)!.notes);
    const calls = roleCalls(db, runId, 'director');
    console.log(`\n  checks: pass after ${calls.length - 1} repair(s)`);
    if (shouldRecord(process.argv, calls.length - 1)) {
      const dir = fixtureResponsesDir('director', topic.id);
      const n = recordResponses(dataDir, calls, dir, 'director');
      console.log(`  recorded ${n} response(s) -> ${shown(dir)}/director.json`);
    }
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
