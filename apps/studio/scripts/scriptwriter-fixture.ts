/**
 * `pnpm --filter @explainer-studio/studio scriptwriter:fixture [--topic <topic>] [--level <level>]
 * [--record]`: runs the Scriptwriter on a fixture topic (`rate-limiter`, the default, or
 * `tokenizer`) against the configured model (needs DEEPSEEK_API_KEY), in a scratch data dir with
 * its own database: <DATA_DIR>/scriptwriter/fixture/<topic>/ (wiped first; the studio DB is not
 * touched). The sources are ingested, then the Researcher and the Director replay their recorded
 * answers for the topic, or run live when the topic has none (so a new topic runs the whole
 * chain). `--level` sets the run's explanation level (default: the app's `settings.video`).
 * Prints the job log, each live role's attempts with their repair issues and cost, the plan when
 * the Director ran live, and the script beat by beat (word budget vs actual, headline, full
 * narration, tags, stat cards, source); the step files stay there. With --record, the run's
 * Scriptwriter responses (every attempt, repairs included) replace the topic's dry-run fixture
 * (only the Scriptwriter's). Read the narration and review the diff before committing.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  narrationWords,
  type ResearchNotes,
  type ScriptwriterInput,
  type ScriptwriterOutput,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { latestDirection } from '#core/services/direction.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { latestScript } from '#core/services/script.ts';
import { fixtureResponsesDir, type FixtureTopic } from '#worker/agents/fixture-topics.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import { SCRIPT_JOB_TYPE, scriptJobHandler } from '#worker/jobs/script.ts';
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
  topicArg,
} from './agent-fixture.ts';

const runJob = (db: Db, registry: JobRegistry, jobId: number) =>
  runAgentJob(db, registry, jobId, 'scriptwriter-fixture');

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
    settings: { video: config.video, research: config.research, timing: config.timing },
  };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    scriptJobHandler(deps),
  ]);
}

/** Ingest, research and direct (replayed or live); false when a step failed. */
async function prepareRun(db: Db, registry: JobRegistry, runId: number) {
  let ok = await runJob(db, registry, listRunJobs(db, runId)[0]!.id);
  for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
    ok = ok && (await runJob(db, registry, enqueueJob(db, { type, runId }).id));
  }
  return ok;
}

function numberText(notes: ResearchNotes, id: string): string {
  const n = notes.numbers.find((x) => x.id === id);
  return n ? `${id} = ${n.value} ${n.unit}`.trim() : `${id} = ?`;
}

function printScript(output: ScriptwriterOutput, input: ScriptwriterInput, notes: ResearchNotes) {
  const budgets = new Map(input.budgets.map((b) => [b.beatId, b]));
  let words = 0;
  let target = 0;
  for (const beat of output.script) {
    const budget = budgets.get(beat.beatId);
    const count = narrationWords(beat.narration).length;
    words += count;
    target += budget?.words ?? 0;
    const fits = budget && count >= budget.min && count <= budget.max ? 'ok' : 'OUT';
    const range = budget ? `${budget.min}-${budget.max} (target ${budget.words})` : '?';
    console.log(`\n  ${beat.beatId}  ${count} words, budget ${range} ${fits}`);
    if (beat.headline)
      console.log(`    headline [${beat.headline.semantic}]: ${beat.headline.text}`);
    console.log(`    narration: ${beat.narration}`);
    if (beat.tags.length > 0) console.log(`    tags: ${beat.tags.join(' | ')}`);
    for (const card of beat.statCards) {
      console.log(
        `    stat card: ${card.value} / ${card.label} (${numberText(notes, card.sourceRef)})`,
      );
    }
    if (beat.formulaCard) console.log(`    formula: ${beat.formulaCard.latex}`);
    if (beat.commandBubble) console.log(`    command: ${beat.commandBubble.text}`);
    if (beat.source) console.log(`    source: ${beat.source}`);
  }
  console.log(`\n  total: ${words} words (budget target ${target})`);
}

function printResult(db: Db, dataDir: string, runId: number, directorLive: boolean): void {
  const { output, input } = latestScript(db, dataDir, runId)!;
  const notes = researchOfStep(db, dataDir, input.researchStepId)!.notes;
  if (directorLive) printPlan(latestDirection(db, dataDir, runId)!.plan, notes);
  printScript(output, input, notes);
}

function record(topic: FixtureTopic, db: Db, dataDir: string, runId: number, shown: string) {
  const dir = fixtureResponsesDir('scriptwriter', topic.id);
  const n = recordResponses(dataDir, roleCalls(db, runId, 'scriptwriter'), dir, 'scriptwriter');
  console.log(`  recorded ${n} response(s) -> ${shown}`);
}

async function main(): Promise<number> {
  const config = loadConfig();
  const topic = topicArg(process.argv);
  const level = levelArg(process.argv);
  const dataDir = join(config.dataDir, 'scriptwriter', 'fixture', topic.id);
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const chain = chainTransport(config, topic.id, 'scriptwriter');
    const registry = registryFor(config, db, dataDir, chain.transport);
    console.log(
      `${topic.id} fixture: model ${config.llm.models.scriptwriter}, level ${level ?? config.video.explanationLevel}, live: ${chain.live.join(', ')}`,
    );
    const { runId } = seedFixtureRun(db, dataDir, topic, level);
    const ready = await prepareRun(db, registry, runId);
    const written =
      ready && (await runJob(db, registry, enqueueJob(db, { type: SCRIPT_JOB_TYPE, runId }).id));
    printLog(db, runId);
    printLiveRoles(db, dataDir, runId, chain.live);
    console.log(`  files -> ${shown(dataDir)}`);
    if (!written) return 1;

    printResult(db, dataDir, runId, chain.live.includes('director'));
    const repairs = roleCalls(db, runId, 'scriptwriter').length - 1;
    console.log(`\n  checks: pass after ${repairs} repair(s)`);
    if (process.argv.includes('--record')) {
      const target = `${shown(fixtureResponsesDir('scriptwriter', topic.id))}/scriptwriter.json`;
      record(topic, db, dataDir, runId, target);
    }
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
