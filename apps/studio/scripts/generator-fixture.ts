/**
 * `pnpm --filter @explainer-studio/studio generator:fixture [--topic <topic>] [--level <level>]
 * [--beat <beatId>] [--record [--max-repairs <n>]]`: runs the Generator on a fixture topic
 * (`rate-limiter`, the default, or `tokenizer`) against the configured model (needs
 * DEEPSEEK_API_KEY), in a scratch data dir with its own database:
 * <DATA_DIR>/generator/fixture/<topic>/ (wiped first). Ingestion runs, the Researcher, Director
 * and Scriptwriter replay their recordings (or run live when the topic has none), spec v1 is the
 * plan and script with the committed timing fixture (`generator:timing`), then the `generate`
 * job runs. With `--beat`, only that beat and the later beats of its chain call the model; every
 * other beat replays the topic's Generator recording. Prints each beat's attempts with the issue
 * codes of every failed one, the job's cost and cache hits, post-pass retries and warnings left
 * for gate 3, asset swaps and missing assets, and every board (what enters on which word, the
 * focus). With --record, the Generator's responses (keyed by beat, repairs included; with
 * `--beat`, the replayed beats are recorded again as they were) replace the topic's dry-run
 * fixture, only when the job finished and every beat needed at most `--max-repairs` repairs.
 */
import { existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  assembleScriptedSpec,
  GeneratorBeatInputSchema,
  GeneratorBeatOutputSchema,
  normalizeWord,
  validateVideoSpec,
  type BeatScene,
  type VideoSpec,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { readMissingAssets } from '#core/assets/render-assets.ts';
import { readDataJson } from '#core/data-files.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import type { LlmCallRow } from '#core/db/repositories/llm-calls.ts';
import { getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { runSteps } from '#core/db/schema.ts';
import { latestDirection } from '#core/services/direction.ts';
import { latestGeneration } from '#core/services/generation.ts';
import { latestScript } from '#core/services/script.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { fixtureResponsesDir, type FixtureTopic } from '#worker/agents/fixture-topics.ts';
import { beatDependents } from '#worker/agents/generator/schedule.ts';
import { loadTimingFixture, withFixtureTiming } from '#worker/agents/generator/timing-fixture.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { GENERATE_JOB_TYPE, generateJobHandler } from '#worker/jobs/generate.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import { SCRIPT_JOB_TYPE, scriptJobHandler } from '#worker/jobs/script.ts';
import {
  createLlmClient,
  dryRunTransport,
  loadDryRunFixtures,
  type LlmTransport,
} from '#worker/llm/index.ts';
import { resolveTimingOptions } from '#worker/timing/assemble.ts';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  chainTransport,
  levelArg,
  printLog,
  recordKeyedResponses,
  roleCalls,
  runJob as runAgentJob,
  seedFixtureRun,
  shouldRecord,
  topicArg,
} from './agent-fixture.ts';

const runJob = (db: Db, registry: JobRegistry, jobId: number) =>
  runAgentJob(db, registry, jobId, 'generator-fixture');

/** The plan's estimate per video with prefix caching (P1C.7 plan §2). */
const PLAN_ESTIMATE_USD: Readonly<Record<FixtureTopic['id'], number>> = {
  'rate-limiter': 0.11,
  tokenizer: 0.1,
};

function beatArg(argv: readonly string[]): string | undefined {
  const i = argv.indexOf('--beat');
  if (i < 0) return undefined;
  const id = argv[i + 1];
  if (!id || id.startsWith('--')) throw new Error('--beat needs a beat id');
  return id;
}

function registryFor(config: AppConfig, db: Db, dataDir: string, transport: LlmTransport) {
  const llm = createLlmClient({ db, dataDir, llm: config.llm, transport });
  const deps = {
    db,
    dataDir,
    llm,
    prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
    settings: {
      video: config.video,
      research: config.research,
      timing: config.timing,
      llm: config.llm,
    },
  };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    scriptJobHandler(deps),
    generateJobHandler(deps),
  ]);
}

/**
 * The chain's transport, with the Generator's calls replayed from its recording for every beat
 * not in `live` (when `--beat` limits which beats call the model).
 */
function generatorTransport(
  config: AppConfig,
  topic: FixtureTopic,
  live: { keys: Set<string> | undefined },
) {
  const chain = chainTransport(config, topic.id, 'generator');
  if (!beatArg(process.argv)) return chain;
  const dir = fixtureResponsesDir('generator', topic.id);
  if (!existsSync(join(dir, 'generator.json'))) {
    throw new Error(`--beat replays the other beats, but ${topic.id} has no Generator recording.`);
  }
  const recorded = dryRunTransport({ generator: loadDryRunFixtures(dir).generator ?? {} });
  const transport: LlmTransport = {
    send: (req) =>
      req.role === 'generator' && live.keys && !live.keys.has(req.replayKey ?? '')
        ? recorded.send(req)
        : chain.transport.send(req),
  };
  return { ...chain, transport };
}

/** Ingest, research, direct and script (replayed or live); false when a step failed. */
async function prepareRun(db: Db, registry: JobRegistry, runId: number): Promise<boolean> {
  let ok = await runJob(db, registry, listRunJobs(db, runId)[0]!.id);
  for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE, SCRIPT_JOB_TYPE]) {
    ok = ok && (await runJob(db, registry, enqueueJob(db, { type, runId }).id));
  }
  return ok;
}

/** Spec v1 as P1C.9 will save it (plan + script), timed with the committed fixture. */
function saveScriptedSpec(
  config: AppConfig,
  db: Db,
  dataDir: string,
  runId: number,
  topic: FixtureTopic,
) {
  const plan = latestDirection(db, dataDir, runId)!.plan;
  const script = latestScript(db, dataDir, runId)!.output.script;
  const assembled = validateVideoSpec(
    assembleScriptedSpec(plan, script, {
      id: `run-${runId}`,
      series: topic.seriesTag,
      seriesNumber: 1,
    }),
  );
  if (!assembled.spec) throw new Error('The plan and script do not assemble into a spec.');
  const pauses = resolveTimingOptions(undefined, config.timing);
  const spec = withFixtureTiming(assembled.spec, loadTimingFixture(topic.id), pauses);
  return { spec, saved: saveSpecVersion(db, dataDir, { runId, spec, createdBy: 'agent' }) };
}

interface BeatStepRow {
  readonly id: number;
  readonly beatId: string;
  readonly status: string;
  readonly inputPath: string | null;
  readonly outputPath: string | null;
  readonly error: string | null;
}

function beatSteps(db: Db, runId: number): BeatStepRow[] {
  return db
    .select()
    .from(runSteps)
    .where(
      and(eq(runSteps.runId, runId), eq(runSteps.stage, 'generate'), isNotNull(runSteps.beatId)),
    )
    .orderBy(asc(runSteps.id))
    .all()
    .map((s) => ({ ...s, beatId: s.beatId! }));
}

/** The repair lines the next attempt was sent (`- path: message`). */
function repairLines(dataDir: string, next: LlmCallRow | undefined): string[] {
  if (!next) return [];
  const prompt = readDataJson(dataDir, next.promptPath) as { messages: { content: string }[] };
  return (prompt.messages.at(-1)?.content ?? '').split('\n').filter((l) => l.startsWith('- '));
}

function printAttempts(db: Db, dataDir: string, runId: number): Map<number, number> {
  const calls = roleCalls(db, runId, 'generator');
  const repairs = new Map<number, number>();
  console.log('\n  attempts per beat:');
  for (const step of beatSteps(db, runId)) {
    const reason = step.inputPath
      ? GeneratorBeatInputSchema.parse(readDataJson(dataDir, step.inputPath)).reason
      : '?';
    const mine = calls.filter((c) => c.stepId === step.id);
    repairs.set(step.id, Math.max(0, mine.length - 1));
    console.log(
      `    ${step.beatId} [${reason}] step ${step.id}: ${mine.length} attempt(s), ${step.status}`,
    );
    mine.forEach((call, i) => {
      const tokens = `${call.tokensInCached} cached + ${call.tokensInUncached} uncached in, ${call.tokensOut} out`;
      console.log(
        `      ${i + 1}. ${call.error ?? 'passed'} (${tokens}, $${call.costUsd.toFixed(4)})`,
      );
      for (const line of repairLines(dataDir, mine[i + 1])) console.log(`         ${line}`);
    });
    // The last failed attempt's issues are only in the step's error (no repair followed).
    if (step.status === 'failed' && step.error) {
      for (const line of step.error.split('\n').filter((l) => l.startsWith('- '))) {
        console.log(`         ${line}`);
      }
    }
  }
  return repairs;
}

function printUsage(db: Db, runId: number, topic: FixtureTopic): void {
  const calls = roleCalls(db, runId, 'generator');
  const sum = (pick: (c: LlmCallRow) => number) => calls.reduce((s, c) => s + pick(c), 0);
  const cached = sum((c) => c.tokensInCached);
  const uncached = sum((c) => c.tokensInUncached);
  const out = sum((c) => c.tokensOut);
  const reasoning = sum((c) => c.tokensReasoning);
  const cost = sum((c) => c.costUsd);
  const hit = cached + uncached > 0 ? Math.round((cached / (cached + uncached)) * 100) : 0;
  const n = (v: number) => v.toLocaleString('en-US');
  console.log(
    `\n  usage: ${calls.length} calls, $${cost.toFixed(4)} (plan estimate ~$${PLAN_ESTIMATE_USD[topic.id].toFixed(2)})`,
  );
  console.log(
    `    input ${n(cached + uncached)} (cache hit ${n(cached)}, ${hit}%), output ${n(out)} (reasoning ${n(reasoning)})`,
  );
  const first = calls[0];
  if (first) {
    console.log(
      `    per call: ~${n(Math.round((cached + uncached) / calls.length))} in, ~${n(Math.round(out / calls.length))} out; first call ${n(first.tokensInCached)} cached + ${n(first.tokensInUncached)} uncached`,
    );
  }
}

function printPostPass(db: Db, dataDir: string, runId: number): void {
  const generation = latestGeneration(db, dataDir, runId);
  if (!generation) return;
  const { beats, warnings } = generation.output;
  const retried = beats.filter((b) => b.retried).map((b) => b.beatId);
  console.log(`\n  post-pass retries: ${retried.join(', ') || 'none'}`);
  console.log(`  warnings for gate 3: ${warnings.length}`);
  for (const w of warnings) {
    console.log(
      `    ${w.beatId} ${w.path} [${w.code ?? '-'}${w.soft ? ', soft' : ''}] ${w.message}`,
    );
  }
}

function printAssets(db: Db, dataDir: string, runId: number): void {
  const swaps = beatSteps(db, runId).flatMap((step) => {
    if (step.status !== 'done' || !step.outputPath) return [];
    const output = GeneratorBeatOutputSchema.parse(readDataJson(dataDir, step.outputPath));
    return output.swaps.map((s) => `${step.beatId} ${s.path}: ${s.from} -> ${s.to}`);
  });
  console.log(`\n  asset swaps: ${swaps.length === 0 ? 'none' : ''}`);
  for (const s of swaps) console.log(`    ${s}`);
  const missing = readMissingAssets(dataDir, runId);
  console.log(`  missing assets: ${missing.length === 0 ? 'none' : ''}`);
  for (const m of missing) console.log(`    ${m.id} (${m.uses.map((u) => u.beatId).join(', ')})`);
}

/** The narration tokens as `narrationWords` counts them (the indices anchors use). */
function tokens(narration: string): string[] {
  return narration.split(/\s+/).filter((t) => normalizeWord(t).length > 0);
}

function textOf(props: Record<string, unknown>): string {
  const text = ['title', 'text', 'label', 'value', 'subtitle']
    .map((k) => props[k])
    .filter((v): v is string => typeof v === 'string');
  return text.length ? ` "${text.join(' / ')}"` : '';
}

function printBoard(scene: BeatScene, words: readonly string[]): void {
  const cont = scene.continuesPrevious ? ' (continues)' : '';
  const mode = scene.layoutMode ? ` ${scene.layoutMode}` : '';
  const zoom = scene.zoomFrom ? `, zoom from ${scene.zoomFrom}` : '';
  console.log(`\n    ${scene.beatId}${mode}${cont}, transition ${scene.transitionIn}${zoom}`);
  for (const e of scene.elements) {
    const props = e.props;
    const pin = props.pin as { to?: string; side?: string } | undefined;
    const where = e.zone ? ` [${e.zone}]` : pin?.to ? ` [pinned ${pin.side} of ${pin.to}]` : '';
    console.log(`      el ${e.id}: ${e.primitive}${textOf(props)}${where}`);
  }
  for (const p of scene.patterns)
    console.log(`      pattern ${p.id}: ${p.pattern} ${JSON.stringify(p.params)}`);
  for (const ev of scene.events) {
    const at =
      ev.at.type === 'word'
        ? `${ev.at.index} "${words[ev.at.index] ?? '?'}"`
        : JSON.stringify(ev.at);
    const params = ev.params ? ` ${JSON.stringify(ev.params)}` : '';
    console.log(`      @${at}: ${ev.action} ${ev.targets.join(', ')}${params}`);
  }
  console.log(`      focus: ${scene.focus.join(', ') || '(none)'}`);
}

/**
 * Every board drawn: the saved spec's when the job finished, else each beat's newest finished
 * step (a failed job still shows what passed).
 */
function printBoards(db: Db, dataDir: string, runId: number, spec: VideoSpec): void {
  const generation = latestGeneration(db, dataDir, runId);
  const saved = generation
    ? validateVideoSpec(
        readDataJson(dataDir, getSpecVersion(db, generation.output.specVersionId)!.jsonPath),
      ).spec?.scenes
    : undefined;
  const scenes = saved ?? finishedScenes(db, dataDir, runId, spec);
  console.log(`\n  boards${saved ? '' : ' (finished beats only)'}:`);
  for (const scene of scenes) {
    const narration = spec.script?.find((s) => s.beatId === scene.beatId)?.narration ?? '';
    console.log(`    -- ${narration}`);
    printBoard(scene, tokens(narration));
  }
}

function finishedScenes(db: Db, dataDir: string, runId: number, spec: VideoSpec): BeatScene[] {
  const newest = new Map<string, BeatScene>();
  for (const step of beatSteps(db, runId)) {
    if (step.status !== 'done' || !step.outputPath) continue;
    newest.set(
      step.beatId,
      GeneratorBeatOutputSchema.parse(readDataJson(dataDir, step.outputPath)).scene,
    );
  }
  return spec.story.beats.flatMap((b) => newest.get(b.id) ?? []);
}

function record(
  db: Db,
  dataDir: string,
  runId: number,
  topic: FixtureTopic,
  shown: (path: string) => string,
): void {
  const dir = fixtureResponsesDir('generator', topic.id);
  const calls = roleCalls(db, runId, 'generator');
  const n = recordKeyedResponses(dataDir, calls, dir, 'generator');
  console.log(`  recorded ${n} response(s) -> ${shown(join(dir, 'generator.json'))}`);
}

async function main(): Promise<number> {
  const config = loadConfig();
  const topic = topicArg(process.argv);
  const level = levelArg(process.argv);
  const beat = beatArg(process.argv);
  const dataDir = join(config.dataDir, 'generator', 'fixture', topic.id);
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  const live: { keys: Set<string> | undefined } = { keys: undefined };
  try {
    const chain = generatorTransport(config, topic, live);
    const registry = registryFor(config, db, dataDir, chain.transport);
    console.log(
      `${topic.id} fixture: model ${config.llm.models.generator}, level ${level ?? config.video.explanationLevel}, live: ${chain.live.join(', ')}${beat ? ` (Generator: ${beat} and its chain)` : ''}`,
    );
    const { runId } = seedFixtureRun(db, dataDir, topic, level);
    if (!(await prepareRun(db, registry, runId))) {
      printLog(db, runId);
      return 1;
    }
    const { spec, saved } = saveScriptedSpec(config, db, dataDir, runId, topic);
    if (beat) {
      const index = spec.story.beats.findIndex((b) => b.id === beat);
      if (index < 0) throw new Error(`${topic.id} has no beat "${beat}".`);
      live.keys = new Set([
        beat,
        ...beatDependents(spec, index).map((j) => spec.story.beats[j]!.id),
      ]);
    }
    const job = enqueueJob(db, {
      type: GENERATE_JOB_TYPE,
      runId,
      payload: { specVersionId: saved.version.id },
    });
    const done = await runJob(db, registry, job.id);
    printLog(db, runId);
    const repairs = printAttempts(db, dataDir, runId);
    printUsage(db, runId, topic);
    printPostPass(db, dataDir, runId);
    printAssets(db, dataDir, runId);
    printBoards(db, dataDir, runId, spec);
    console.log(`\n  files -> ${shown(dataDir)}`);
    if (!done) return 1;
    const most = Math.max(0, ...repairs.values());
    console.log(`  checks: every beat passed, at most ${most} repair(s) on one beat`);
    if (shouldRecord(process.argv, most)) record(db, dataDir, runId, topic, shown);
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
