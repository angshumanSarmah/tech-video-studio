/**
 * `pnpm --filter @explainer-studio/studio draft:fixture [--topic <id>] [--live] [--live-curate]
 * [--timeout <sec>]` (P1C.7 step 12, P1C.8 step 10; needs `pnpm tts:setup`): a fixture topic from
 * sources to a draft video, through the real job handlers, in a scratch data dir
 * (`<DATA_DIR>/draft/fixture/<topic>/`, rebuilt each run):
 *   1. ingest, research, direct and script, replayed from the topic's recordings;
 *   2. spec v1 from the plan and script (as P1C.9 will save it);
 *   3. `tts` with Kokoro (its cache in the main data dir, shared with the worker);
 *   4. `generate`, replayed from the Generator recording (`--live`: the configured model);
 *   5. `tts` again: all cache hits, adds the landing holds now that boards exist;
 *   6. `curate`: replayed, review only, from the Curator recording; `--live-curate`: the review
 *      and its repair loop live (the Curator, and the Scriptwriter and Generator it sends repairs
 *      to, on the configured models; Kokoro narrates changed beats);
 *   7. `render_draft` and `render_stills` of the curated version, then a contact sheet.
 * Prints each stage's time, the curation (issues found, every repair round with how each beat's
 * board was kept, remapped or redrawn and the new narration of each changed beat, why it
 * stopped, what reached the gate, the cost), the run's warning logs and the paths of
 * `draft.mp4`, the stills, the contact sheet and `missing-assets.json`. Nothing is recorded.
 */
import { existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  assembleScriptedSpec,
  validateVideoSpec,
  type CuratorReport,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import {
  beatStillPath,
  missingAssetsPath,
  readDataJson,
  resolveDataPath,
  runDraftPath,
} from '#core/data-files.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { getLatestSpecVersion, getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { latestCuration } from '#core/services/curation.ts';
import { latestDirection } from '#core/services/direction.ts';
import { latestScript } from '#core/services/script.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import {
  FIXTURE_ROLES,
  fixtureResponsesDir,
  type FixtureTopic,
} from '#worker/agents/fixture-topics.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { CURATE_JOB_TYPE, curateJobHandler } from '#worker/jobs/curate.ts';
import { DIRECT_JOB_TYPE } from '#worker/jobs/direct.ts';
import { GENERATE_JOB_TYPE } from '#worker/jobs/generate.ts';
import { createJobHandlers, createJobRegistry, type JobRegistry } from '#worker/jobs/registry.ts';
import { RENDER_JOB_TYPES } from '#worker/jobs/render.ts';
import { RESEARCH_JOB_TYPE } from '#worker/jobs/research.ts';
import { SCRIPT_JOB_TYPE } from '#worker/jobs/script.ts';
import { TTS_JOB_TYPE } from '#worker/jobs/tts.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  loadDryRunFixtures,
  type LlmTransport,
} from '#worker/llm/index.ts';
import { probeArgs } from '#worker/render/ffmpeg-args.ts';
import { runFf, runFfmpeg } from '#worker/render/ffmpeg.ts';
import { createRemotionEngine } from '#worker/render/remotion-engine.ts';
import { createKokoroTts } from '#worker/tts/kokoro.ts';
import {
  chainTransport,
  runJob as runAgentJob,
  seedFixtureRun,
  topicArg,
} from './agent-fixture.ts';
import { contactSheet } from './contact-sheet.ts';
import { decodePng, encodePng } from './golden/png.ts';
import { parseProbe } from './media-checks.ts';

const SHEET = { columns: 4, gap: 16, background: [32, 32, 32, 255] } as const;

type Stage = { readonly name: string; readonly sec: number };

/** Every role replayed from the topic's recordings, or the Generator live (`--live`). */
function transportFor(config: AppConfig, topic: FixtureTopic, live: boolean): LlmTransport {
  if (live) return chainTransport(config, topic.id, 'generator').transport;
  const recorded = Object.fromEntries(
    FIXTURE_ROLES.map((role) => [
      role,
      loadDryRunFixtures(fixtureResponsesDir(role, topic.id))[role],
    ]),
  );
  return dryRunTransport(recorded);
}

/** Spec v1: the plan and script assembled, before TTS. */
function saveScriptedSpec(db: Db, dataDir: string, runId: number, topic: FixtureTopic): number {
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
  return saveSpecVersion(db, dataDir, { runId, spec: assembled.spec, createdBy: 'agent' }).version
    .id;
}

/** The newest spec version's row id (each job that changes the spec saves one). */
const latestVersionId = (db: Db, runId: number) => getLatestSpecVersion(db, runId)!.id;

function warningLogs(db: Db, runId: number): string[] {
  return listEventsSince(db, { runId, afterId: 0, limit: 2_000 })
    .filter((e) => e.type === 'log')
    .map((e) => e.payload as { level: string; message: string })
    .filter((p) => p.level === 'warn' || p.level === 'error')
    .map((p) => `[${p.level}] ${p.message}`);
}

/** One still per beat, in beat order, tiled into `contact-sheet.png` in the data dir. */
async function writeContactSheet(dataDir: string, runId: number, beatIds: readonly string[]) {
  const scratch = join(dataDir, 'contact-sheet.rgba');
  const images = [];
  for (const id of beatIds) {
    images.push(await decodePng(resolveDataPath(dataDir, beatStillPath(runId, id)), scratch));
  }
  const sheet = contactSheet(images, SHEET);
  const path = join(dataDir, 'contact-sheet.png');
  await encodePng(sheet.rgba, sheet.size, path, scratch);
  return path;
}

function withTimeout(config: AppConfig): AppConfig {
  const i = process.argv.indexOf('--timeout');
  if (i < 0) return config;
  return { ...config, llm: { ...config.llm, requestTimeoutSec: Number(process.argv[i + 1]) } };
}

/** The curation: what was found, each repair round, why it stopped, the gate, the cost. */
function printCuration(report: CuratorReport): void {
  const start =
    report.rounds[0]?.blockingBefore ??
    report.badges
      .filter((b) => b.severity === 'blocking')
      .map((b) => `${b.beatId ?? ''}:${b.code}`);
  console.log(
    `\n  curation: v${report.version} -> v${report.final.version}, stopped: ${report.stop}`,
  );
  console.log(`  blocking at the start: ${start.join(', ') || 'none'}`);
  for (const round of report.rounds) {
    console.log(`  round ${round.round}:`);
    for (const r of round.requests) {
      const codes = r.issues.map((i) => i.code).join(', ');
      console.log(`    request ${r.beatId} -> ${r.owner} (${r.fields.join(', ')}): ${codes}`);
    }
    for (const b of round.repair.beats) {
      const lost = b.lost ? ` (lost: ${b.lost.join(', ')})` : '';
      console.log(`    ${b.beatId}: script ${b.script}, board ${b.board}${lost}`);
      if (b.narration) {
        console.log(`      before: ${b.narration.before}`);
        console.log(`      after:  ${b.narration.after}`);
      }
    }
    if (round.restored.length > 0) console.log(`    put back: ${round.restored.join(', ')}`);
    console.log(`    blocking after: ${round.blockingAfter.join(', ') || 'none'}`);
    const u = round.repair.usage;
    console.log(`    repair cost: $${u.costUsd.toFixed(4)} (${u.calls} calls)`);
  }
  console.log(
    `  gate 3: ${report.blocking ? 'BLOCKED' : 'clear'}; ${report.badges.length} badge(s)`,
  );
  for (const b of report.badges) {
    const plan = b.needsPlanChange ? ' [needs a plan change]' : '';
    console.log(`    ${b.severity} ${b.owner} ${b.beatId ?? 'video'} ${b.source}:${b.code}${plan}`);
  }
  const calls = report.review?.calls;
  console.log(
    `  curation cost: $${report.cost.totalUsd.toFixed(4)} (review ` +
      `$${report.cost.reviewUsd.toFixed(4)}, repairs $${report.cost.repairUsd.toFixed(4)}; ` +
      `review calls ${calls?.claims ?? 0} claims + ${calls?.story ?? 0} story)`,
  );
}

async function main(): Promise<number> {
  const config = withTimeout(loadConfig());
  const topic = topicArg(process.argv);
  const live = process.argv.includes('--live');
  const liveCurate = process.argv.includes('--live-curate');
  const dataDir = join(config.dataDir, 'draft', 'fixture', topic.id);
  const shown = (path: string) => relative(config.workspaceRoot, path);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  const engine = createRemotionEngine();
  // The TTS cache and pronunciations live in the main data dir, shared with the worker.
  const tts = createKokoroTts({
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    python: config.tts.binaryPath,
    log: (message) => console.warn(`  [tts] ${message}`),
  });
  const llm = createLlmClient({
    db,
    dataDir,
    llm: config.llm,
    transport: transportFor(config, topic, live),
  });
  const settings = {
    tts: config.tts,
    timing: config.timing,
    video: config.video,
    research: config.research,
    llm: config.llm,
  };
  const registry = createJobRegistry(
    createJobHandlers({
      db,
      dataDir,
      tools: { engine, ffmpeg: runFfmpeg, settings: config.render },
      tts: tts.provider,
      settings,
      llm,
      prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
    }),
  );
  // The curate job on its own client: live, its repairs' Scriptwriter and Generator calls go to
  // the model while every earlier stage replays the same roles' recordings.
  const curateRegistry = liveCurate
    ? createJobRegistry([
        curateJobHandler({
          db,
          dataDir,
          tts: tts.provider,
          settings,
          llm: createLlmClient({
            db,
            dataDir,
            llm: config.llm,
            transport: createLlmTransport(config.llm),
          }),
          prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
        }),
      ])
    : registry;
  try {
    console.log(
      `${topic.id} draft fixture: Generator ${live ? 'live' : 'replayed'}, ` +
        `curate ${liveCurate ? 'live with repairs' : 'replayed, review only'}`,
    );
    const stages: Stage[] = [];
    const runId = await runStages(db, dataDir, registry, topic, stages, {
      registry: curateRegistry,
      repair: liveCurate,
    });
    for (const s of stages) console.log(`  ${s.name.padEnd(14)} ${s.sec.toFixed(1)} s`);
    if (runId === undefined) return 1;
    await report(db, dataDir, runId, shown);
    return 0;
  } finally {
    await tts.provider.close();
    closeDatabase(db);
  }
}

/** Runs the pipeline's jobs in order, timing each; the run, or undefined (with why) on a failure. */
async function runStages(
  db: Db,
  dataDir: string,
  registry: JobRegistry,
  topic: FixtureTopic,
  stages: Stage[],
  curation: { readonly registry: JobRegistry; readonly repair: boolean },
): Promise<number | undefined> {
  const { runId } = seedFixtureRun(db, dataDir, topic, undefined);
  const timed = async (name: string, step: () => Promise<boolean>) => {
    const started = performance.now();
    const ok = await step();
    stages.push({ name, sec: (performance.now() - started) / 1000 });
    return ok;
  };
  const job = (type: string, payload?: Record<string, unknown>) => () =>
    runAgentJob(db, registry, enqueueJob(db, { type, runId, payload }).id, 'draft-fixture');
  const onVersion = (type: string) => () =>
    job(type, { specVersionId: latestVersionId(db, runId) })();
  // The version the curation ended on (keep-best may have put beats back).
  const curated = () => ({
    specVersionId: latestCuration(db, dataDir, runId)!.report.final.specVersionId,
  });
  const ok =
    (await timed('ingest', () =>
      runAgentJob(db, registry, listRunJobs(db, runId)[0]!.id, 'draft-fixture'),
    )) &&
    (await timed('research', job(RESEARCH_JOB_TYPE))) &&
    (await timed('direct', job(DIRECT_JOB_TYPE))) &&
    (await timed('script', job(SCRIPT_JOB_TYPE))) &&
    (await timed('spec v1', () =>
      Promise.resolve(saveScriptedSpec(db, dataDir, runId, topic) > 0),
    )) &&
    (await timed('tts', onVersion(TTS_JOB_TYPE))) &&
    (await timed('generate', onVersion(GENERATE_JOB_TYPE))) &&
    (await timed('tts (holds)', onVersion(TTS_JOB_TYPE))) &&
    (await timed('curate', () =>
      runAgentJob(
        db,
        curation.registry,
        enqueueJob(db, {
          type: CURATE_JOB_TYPE,
          runId,
          payload: { specVersionId: latestVersionId(db, runId), repair: curation.repair },
        }).id,
        'draft-fixture',
      ),
    )) &&
    (await timed('render_draft', job(RENDER_JOB_TYPES.draft, curated()))) &&
    (await timed('render_stills', job(RENDER_JOB_TYPES.stills, curated())));
  if (ok) return runId;
  for (const line of warningLogs(db, runId)) console.log(`  ${line}`);
  return undefined;
}

/** Paths, the draft's length, warnings and the contact sheet. */
async function report(
  db: Db,
  dataDir: string,
  runId: number,
  shown: (path: string) => string,
): Promise<void> {
  const curation = latestCuration(db, dataDir, runId)!.report;
  const version = getSpecVersion(db, curation.final.specVersionId)!;
  const spec = validateVideoSpec(readDataJson(dataDir, version.jsonPath)).spec!;
  const draft = resolveDataPath(dataDir, runDraftPath(runId));
  const facts = parseProbe(await runFf('ffprobe', probeArgs(draft)));
  const beatIds = spec.story.beats.map((b) => b.id);
  const sheet = await writeContactSheet(dataDir, runId, beatIds);
  const logs = warningLogs(db, runId);
  console.log(
    `\n  spec v${version.version}: ${beatIds.length} beats, ${spec.timing?.endSec?.toFixed(2) ?? '?'} s`,
  );
  console.log(
    `  draft.mp4: ${facts.durationSec.toFixed(2)} s, ${facts.video?.width}x${facts.video?.height} @ ${facts.video?.fps}`,
  );
  printCuration(curation);
  console.log(`  warning logs: ${logs.length}`);
  for (const line of logs) console.log(`    ${line}`);
  const missing = resolveDataPath(dataDir, missingAssetsPath(runId));
  console.log(`\n  draft          -> ${shown(draft)}`);
  console.log(`  stills         -> ${shown(join(dataDir, 'runs', String(runId), 'stills'))}`);
  console.log(`  contact sheet  -> ${shown(sheet)}`);
  console.log(`  missing assets -> ${existsSync(missing) ? shown(missing) : '(none recorded)'}`);
}

process.exitCode = await main();
