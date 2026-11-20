/**
 * `pnpm --filter @explainer-studio/studio scriptwriter:fixture [--level <level>] [--record]`:
 * runs the Scriptwriter on the rate-limiter fixture against the configured model (needs
 * DEEPSEEK_API_KEY), in a scratch data dir with its own database:
 * <DATA_DIR>/scriptwriter/fixture/rate-limiter/ (wiped first; the studio DB is not touched).
 * Its input is the recorded Director fixture: the sources are ingested and the recorded
 * Researcher and Director answers replayed, so only the Scriptwriter costs anything.
 * `--level` sets the run's explanation level (default: the app's `settings.video`). Prints the
 * job log, each repair's issues, the Scriptwriter's cost and the script beat by beat (word budget
 * vs actual, headline, full narration, tags, stat cards, source), and leaves the step's input,
 * script and LLM call files there. With --record, the run's Scriptwriter responses (every
 * attempt, repairs included) replace the dry-run fixture that `script.test.ts` replays. Read
 * the narration and review the diff before committing.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  narrationWords,
  type ExplanationLevel,
  type ResearchNotes,
  type ScriptwriterInput,
  type ScriptwriterOutput,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { researchOfStep } from '#core/services/research-notes.ts';
import { latestScript } from '#core/services/script.ts';
import { DIRECTOR_RESPONSES_DIR } from '#worker/agents/director/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '#worker/agents/researcher/testing.ts';
import { SCRIPTWRITER_RESPONSES_DIR } from '#worker/agents/scriptwriter/testing.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import { SCRIPT_JOB_TYPE, scriptJobHandler } from '#worker/jobs/script.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  loadDryRunFixtures,
  type LlmTransport,
} from '#worker/llm/index.ts';
import {
  callsCostUsd,
  levelArg,
  printAttempts,
  printLog,
  recordResponses,
  roleCalls,
  runJob as runAgentJob,
} from './agent-fixture.ts';

const runJob = (db: Db, registry: JobRegistry, jobId: number) =>
  runAgentJob(db, registry, jobId, 'scriptwriter-fixture');

/** The recorded Researcher and Director answers, the real API for the Scriptwriter. */
function transport(config: AppConfig): LlmTransport {
  const recorded = dryRunTransport({
    researcher: loadDryRunFixtures(RATE_LIMITER_RESPONSES_DIR).researcher ?? [],
    director: loadDryRunFixtures(DIRECTOR_RESPONSES_DIR).director ?? [],
  });
  const live = createLlmTransport(config.llm);
  return { send: (req) => (req.role === 'scriptwriter' ? live : recorded).send(req) };
}

function registryFor(config: AppConfig, db: Db, dataDir: string): JobRegistry {
  const llm = createLlmClient({ db, dataDir, llm: config.llm, transport: transport(config) });
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

/** Ingest, then replay research and direction; false when a step failed. */
async function prepareRun(
  db: Db,
  registry: JobRegistry,
  dataDir: string,
  level?: ExplanationLevel,
) {
  const seeded = seedRunWithUploads(db, dataDir, RATE_LIMITER_TOPIC, RATE_LIMITER_SOURCE_FILES, {
    settings: level ? { video: { explanationLevel: level } } : undefined,
  });
  const runId = seeded.runId;
  let ok = await runJob(db, registry, listRunJobs(db, runId)[0]!.id);
  for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
    ok = ok && (await runJob(db, registry, enqueueJob(db, { type, runId }).id));
  }
  return { runId, ready: ok };
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

async function main(): Promise<number> {
  const config = loadConfig();
  const record = process.argv.includes('--record');
  const level = levelArg(process.argv);
  const dataDir = join(config.dataDir, 'scriptwriter', 'fixture', 'rate-limiter');
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const registry = registryFor(config, db, dataDir);
    console.log(
      `rate-limiter fixture: model ${config.llm.models.scriptwriter}, level ${level ?? config.video.explanationLevel}`,
    );
    const { runId, ready } = await prepareRun(db, registry, dataDir, level);
    const written =
      ready && (await runJob(db, registry, enqueueJob(db, { type: SCRIPT_JOB_TYPE, runId }).id));
    printLog(db, runId);
    const calls = roleCalls(db, runId, 'scriptwriter');
    printAttempts(dataDir, calls);
    console.log(
      `  scriptwriter cost: $${callsCostUsd(calls).toFixed(4)}; files -> ${shown(dataDir)}`,
    );
    if (!written) return 1;

    const { output, input } = latestScript(db, dataDir, runId)!;
    printScript(output, input, researchOfStep(db, dataDir, input.researchStepId)!.notes);
    console.log(`\n  checks: pass after ${calls.length - 1} repair(s)`);
    if (record) {
      const n = recordResponses(dataDir, calls, SCRIPTWRITER_RESPONSES_DIR, 'scriptwriter');
      console.log(
        `  recorded ${n} response(s) -> ${shown(SCRIPTWRITER_RESPONSES_DIR)}/scriptwriter.json`,
      );
    }
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
