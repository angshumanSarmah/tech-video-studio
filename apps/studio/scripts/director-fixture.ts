/**
 * `pnpm --filter @explainer-studio/studio director:fixture [--level <level>] [--record]`: runs
 * the Director on the rate-limiter fixture against the configured model (needs
 * DEEPSEEK_API_KEY), in a scratch data dir with its own database:
 * <DATA_DIR>/director/fixture/rate-limiter/ (wiped first; the studio DB is not touched).
 * Its input is the recorded Researcher fixture: the sources are ingested and the recorded
 * Researcher answer replayed (no Researcher call), so only the Director costs anything.
 * `--level` sets the run's explanation level (default: the app's `settings.video`). Prints the
 * job log, each repair's issues, the Director's cost and the plan (hook, running example, beats
 * with devices and patterns, ending), and leaves the step's input, plan and LLM call files there.
 * With --record, the run's Director responses (every attempt, repairs included) replace the
 * dry-run fixture that `direct.test.ts` replays. Review the diff before committing.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ExplanationLevelSchema,
  type DirectorPlan,
  type ExplanationLevel,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { readDataJson, resolveDataPath } from '#core/data-files.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls, type LlmCallRow } from '#core/db/repositories/llm-calls.ts';
import { latestDirection } from '#core/services/direction.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { DIRECTOR_RESPONSES_DIR } from '#worker/agents/director/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '#worker/agents/researcher/testing.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  loadDryRunFixtures,
  type DryRunResponse,
  type LlmTransport,
} from '#worker/llm/index.ts';
import { runNextJob } from '#worker/runner.ts';

/** The recorded Researcher answer for the researcher role, the real API for the Director. */
function transport(config: AppConfig): LlmTransport {
  const recorded = dryRunTransport({
    researcher: loadDryRunFixtures(RATE_LIMITER_RESPONSES_DIR).researcher ?? [],
  });
  const live = createLlmTransport(config.llm);
  return { send: (req) => (req.role === 'researcher' ? recorded : live).send(req) };
}

function registryFor(config: AppConfig, db: Db, dataDir: string): JobRegistry {
  const llm = createLlmClient({ db, dataDir, llm: config.llm, transport: transport(config) });
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

async function runJob(db: Db, registry: JobRegistry, jobId: number): Promise<boolean> {
  await runNextJob({
    db,
    registry,
    workerId: 'director-fixture',
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

function directorCalls(db: Db, runId: number): LlmCallRow[] {
  return listRunLlmCalls(db, runId).filter((call) => call.role === 'director');
}

/** Each failed attempt's issues, as the next attempt's repair message lists them. */
function printAttempts(dataDir: string, calls: readonly LlmCallRow[]): void {
  calls.forEach((call, i) => {
    const tokens = `${call.tokensInCached} cached + ${call.tokensInUncached} uncached in, ${call.tokensOut} out`;
    console.log(
      `  attempt ${i + 1}: ${call.error ?? 'passed'} (${tokens}, $${call.costUsd.toFixed(4)})`,
    );
    const next = calls[i + 1];
    if (!call.error || !next) return;
    const prompt = readDataJson(dataDir, next.promptPath) as { messages: { content: string }[] };
    const issues = (prompt.messages.at(-1)?.content ?? '')
      .split('\n')
      .filter((l) => l.startsWith('- '));
    for (const issue of issues) console.log(`    ${issue}`);
  });
}

function printPlan(plan: DirectorPlan, notes: ResearchNotes): void {
  const { meta, story } = plan;
  const values = new Map(notes.numbers.map((n) => [n.id, `${n.value} ${n.unit}`.trim()]));
  const hook = story.beats.find((b) => b.device !== 'recap_opening');
  console.log(
    `\n  title: ${meta.title} (${meta.topicClass}, ${meta.format}, ${meta.targetLengthSec ?? '-'} s)`,
  );
  if (plan.lengthReason) console.log(`  length reason: ${plan.lengthReason}`);
  console.log(`  devices: ${story.devices.join(', ')}`);
  if (hook) {
    const numbers = (hook.hookNumberIds ?? [])
      .filter((id) => values.has(id))
      .map((id) => `${id} = ${values.get(id)}`);
    console.log(`  hook: ${hook.intent} [${numbers.join('; ')}]`);
  }
  console.log(`  running example: ${story.runningExample ?? '(none)'}`);
  if (story.plantedQuestion) {
    const q = story.plantedQuestion;
    console.log(`  planted question: ${q.text} (${q.beatId} -> ${q.payoffBeatId})`);
  }
  if (story.rejectedAlternative) {
    const r = story.rejectedAlternative;
    console.log(`  rejected alternative: ${r.summary} (${r.beatId} -> ${r.chosenBeatId ?? '?'})`);
  }
  for (const part of plan.parts ?? []) {
    console.log(
      `  part ${part.part}: ${part.title} (${part.targetLengthSec} s) ${part.beatIds.join(', ')}`,
    );
  }
  console.log('  beats:');
  for (const b of story.beats) {
    const extras = [
      ...(b.continuesPrevious ? ['continues'] : []),
      b.device ?? '-',
      b.layoutMode ?? '-',
      b.suggestedPatternIds.join('+') || '-',
      b.newTerms.length ? `new: ${b.newTerms.join(', ')}` : '',
      b.source ? `source: ${b.source}` : '',
    ].filter(Boolean);
    console.log(`    ${b.id} [${b.chapterId}] ${b.targetSec} s | ${extras.join(' | ')}`);
    console.log(`      ${b.intent} (${[...(b.hookNumberIds ?? []), ...b.factIds].join(', ')})`);
  }
  const { ending } = story;
  console.log(`  ending: ${ending.kind}`);
  for (const line of ending.specCard?.lines ?? []) console.log(`    | ${line}`);
  if (ending.cta) console.log(`    cta: ${ending.cta}`);
  for (const m of story.missingPrimitiveRequests) {
    console.log(`  missing primitive: ${m.name}: ${m.description} (fallback ${m.fallbackUsed})`);
  }
}

/** The response file the LLM client writes next to each call's prompt. */
interface RecordedResponseFile {
  readonly content: string | null;
  readonly servedModel: string | null;
  readonly finishReason: string | null;
  readonly usage: DryRunResponse['usage'];
}

/** The run's Director responses in call order, as `loadDryRunFixtures` reads them. */
function recordResponses(dataDir: string, calls: readonly LlmCallRow[]): number {
  const responses: DryRunResponse[] = calls
    .filter((call) => call.responsePath)
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
  mkdirSync(DIRECTOR_RESPONSES_DIR, { recursive: true });
  writeFileSync(
    join(DIRECTOR_RESPONSES_DIR, 'director.json'),
    `${JSON.stringify(responses, null, 2)}\n`,
  );
  return responses.length;
}

/** `--level <level>`, validated; undefined when not given. */
function levelArg(argv: readonly string[]): ExplanationLevel | undefined {
  const i = argv.indexOf('--level');
  return i < 0 ? undefined : ExplanationLevelSchema.parse(argv[i + 1]);
}

async function prepareRun(
  db: Db,
  registry: JobRegistry,
  dataDir: string,
  level?: ExplanationLevel,
) {
  const seeded = seedRunWithUploads(db, dataDir, RATE_LIMITER_TOPIC, RATE_LIMITER_SOURCE_FILES, {
    settings: level ? { video: { explanationLevel: level } } : undefined,
  });
  const ingested = await runJob(db, registry, listRunJobs(db, seeded.runId)[0]!.id);
  const research = ingested && enqueueJob(db, { type: RESEARCH_JOB_TYPE, runId: seeded.runId });
  const researched = research && (await runJob(db, registry, research.id));
  return { runId: seeded.runId, ready: Boolean(researched) };
}

async function main(): Promise<number> {
  const config = loadConfig();
  const record = process.argv.includes('--record');
  const level = levelArg(process.argv);
  const dataDir = join(config.dataDir, 'director', 'fixture', 'rate-limiter');
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const registry = registryFor(config, db, dataDir);
    console.log(
      `rate-limiter fixture: model ${config.llm.models.director}, level ${level ?? config.video.explanationLevel}`,
    );
    const { runId, ready } = await prepareRun(db, registry, dataDir, level);
    const directed =
      ready && (await runJob(db, registry, enqueueJob(db, { type: DIRECT_JOB_TYPE, runId }).id));
    printLog(db, runId);
    const calls = directorCalls(db, runId);
    printAttempts(dataDir, calls);
    const cost = calls.reduce((sum, c) => sum + c.costUsd, 0);
    console.log(`  director cost: $${cost.toFixed(4)}; files -> ${shown(dataDir)}`);
    if (!directed) return 1;

    const { plan } = latestDirection(db, dataDir, runId)!;
    printPlan(plan, latestResearch(db, dataDir, runId)!.notes);
    console.log(`\n  checks: pass after ${calls.length - 1} repair(s)`);
    if (record) {
      const n = recordResponses(dataDir, calls);
      console.log(`  recorded ${n} response(s) -> ${shown(DIRECTOR_RESPONSES_DIR)}/director.json`);
    }
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
