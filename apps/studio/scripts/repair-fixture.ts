/**
 * `pnpm --filter @explainer-studio/studio repair:fixture [--topic <topic>] [--beat <id>]
 * [--code <code>] [--timeout <sec>]` (needs DEEPSEEK_API_KEY and `pnpm tts:setup`): one live
 * repair of a fixture topic's finished spec, to see `repairBeats` work end to end. The recorded
 * plan, script and boards with the committed timing are saved as v1; the code checks run; the
 * first finding of `--code` (default `beat_over_target`) on `--beat` (default the first beat with
 * one) becomes a Scriptwriter request for that beat's narration; the repair runs with the
 * Scriptwriter (and the Generator, if a board must be drawn again) live and real Kokoro TTS (its
 * cache in the main data dir). Prints the narration before and after, the beat's measured length
 * before and after, whether its board was remapped or redrawn, the code checks left on the beat,
 * and the cost. In <DATA_DIR>/repair/fixture/<topic>/ (wiped first). Nothing is recorded.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { curatorCodeChecks } from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  measuredBeatLengths,
  type RenderableVideoSpec,
  type RepairRequest,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { readDataJson } from '#core/data-files.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { beatOfPath } from '#worker/agents/curator/input.ts';
import {
  fixtureResponsesDir,
  FIXTURE_WORDS_PER_SEC,
  type FixtureTopic,
} from '#worker/agents/fixture-topics.ts';
import { fixtureGeneratedSpec, recordedNotes } from '#worker/agents/generator/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '#worker/jobs/direct.ts';
import { ingestJobHandler } from '#worker/jobs/ingest.ts';
import { createJobRegistry } from '#worker/jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '#worker/jobs/research.ts';
import {
  createLlmClient,
  createLlmTransport,
  dryRunTransport,
  recordedInOrder,
  type LlmTransport,
} from '#worker/llm/index.ts';
import { repairBeats } from '#worker/repair/repair-beats.ts';
import { createKokoroTts } from '#worker/tts/kokoro.ts';
import { printAttempts, roleCalls, runJob, seedFixtureRun, topicArg } from './agent-fixture.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

function withTimeout(config: AppConfig): AppConfig {
  const value = arg('--timeout');
  if (value === undefined) return config;
  return { ...config, llm: { ...config.llm, requestTimeoutSec: Number(value) } };
}

/** The Researcher and Director replayed (the run needs their steps); every other role live. */
function transportFor(config: AppConfig, topic: FixtureTopic): LlmTransport {
  const recorded = dryRunTransport({
    researcher: recordedInOrder(fixtureResponsesDir('researcher', topic.id), 'researcher'),
    director: recordedInOrder(fixtureResponsesDir('director', topic.id), 'director'),
  });
  const live = createLlmTransport(config.llm);
  return {
    send: (req) =>
      (req.role === 'researcher' || req.role === 'director' ? recorded : live).send(req),
  };
}

function codeChecks(spec: RenderableVideoSpec, topic: FixtureTopic, config: AppConfig) {
  return curatorCodeChecks(spec, {
    theme: getTheme(),
    notes: recordedNotes(topic.id),
    topicTitle: topic.topic.title,
    series:
      topic.seriesTag === 'ai'
        ? { name: 'AI', label: 'AI' }
        : { name: 'System Design', label: 'SYSTEM DESIGN' },
    channelHandle: null,
    video: { ...config.video, wordsPerSec: FIXTURE_WORDS_PER_SEC },
    pauses: { beatGapSec: config.timing.beatGapSec, landingSec: config.timing.landingSec },
    recent: { combos: [], patterns: [] },
  });
}

const savedSpec = (db: Db, dataDir: string, id: number) =>
  readDataJson(dataDir, getSpecVersion(db, id)!.jsonPath) as RenderableVideoSpec;

const lengthOf = (spec: RenderableVideoSpec, beatId: string) => {
  const m = measuredBeatLengths(spec).find((b) => b.beatId === beatId);
  return m
    ? `${m.spanSec.toFixed(1)} s against ${m.targetSec} s (${Math.round((m.spanSec / m.targetSec) * 100)}%)`
    : '?';
};

async function main(): Promise<number> {
  const config = withTimeout(loadConfig());
  const topic = topicArg(process.argv);
  const code = arg('--code') ?? 'beat_over_target';
  const dataDir = join(config.dataDir, 'repair', 'fixture', topic.id);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  const tts = createKokoroTts({
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    python: config.tts.binaryPath,
    log: (message) => console.warn(`  [tts] ${message}`),
  });
  try {
    const llm = createLlmClient({
      db,
      dataDir,
      llm: config.llm,
      transport: transportFor(config, topic),
    });
    const settings = {
      video: config.video,
      research: config.research,
      timing: config.timing,
      tts: config.tts,
      llm: config.llm,
    };
    const deps = {
      db,
      dataDir,
      llm,
      prompts: loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR)),
      settings,
    };
    const reg = createJobRegistry([
      ingestJobHandler(deps),
      researchJobHandler(deps),
      directJobHandler(deps),
    ]);
    const { runId } = seedFixtureRun(db, dataDir, topic, undefined);
    let ok = await runJob(db, reg, listRunJobs(db, runId)[0]!.id, 'repair-fixture');
    for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
      ok = ok && (await runJob(db, reg, enqueueJob(db, { type, runId }).id, 'repair-fixture'));
    }
    if (!ok) return 1;
    const spec = fixtureGeneratedSpec(topic.id);
    const v1 = saveSpecVersion(db, dataDir, { runId, spec, createdBy: 'agent' }).version;
    const finding = codeChecks(spec, topic, config).find(
      (i) =>
        i.code === code &&
        (arg('--beat') === undefined || beatOfPath(spec, i.path) === arg('--beat')),
    );
    if (!finding) {
      console.error(`No ${code} finding${arg('--beat') ? ` on ${arg('--beat')}` : ''}.`);
      return 1;
    }
    const beatId = beatOfPath(spec, finding.path);
    const request: RepairRequest = {
      beatId,
      owner: 'scriptwriter',
      fields: ['narration'],
      issues: [{ code: finding.code, message: finding.message }],
    };
    console.log(`${topic.id}: repairing ${beatId} for ${finding.code}\n  ${finding.message}`);
    const started = Date.now();
    const result = await repairBeats(
      { ...deps, tts: tts.provider },
      {
        runId,
        specVersionId: v1.id,
        requests: [request],
        signal: new AbortController().signal,
        log: (level, message) => console.log(`  [${level}] ${message}`),
      },
    );
    const after = savedSpec(db, dataDir, result.specVersionId);
    const outcome = result.beats.find((b) => b.beatId === beatId);
    console.log(`\n  narration before: ${spec.script.find((s) => s.beatId === beatId)?.narration}`);
    console.log(`  narration after:  ${after.script.find((s) => s.beatId === beatId)?.narration}`);
    console.log(`  measured before:  ${lengthOf(spec, beatId)}`);
    console.log(`  measured after:   ${lengthOf(after, beatId)}`);
    console.log(
      `  board: ${outcome?.board ?? '?'}${outcome?.lost ? ` (lost: ${outcome.lost.join(', ')})` : ''}`,
    );
    for (const b of result.beats.filter((b) => b.beatId !== beatId)) {
      console.log(`  also: ${b.beatId} script ${b.script}, board ${b.board}`);
    }
    const left = codeChecks(after, topic, config).filter(
      (i) => beatOfPath(after, i.path) === beatId,
    );
    console.log(`  code checks left on ${beatId}: ${left.map((i) => i.code).join(', ') || 'none'}`);
    console.log('  scriptwriter attempts:');
    printAttempts(dataDir, roleCalls(db, runId, 'scriptwriter'));
    const u = result.usage;
    console.log(
      `\n  usage: ${u.calls} call(s) (scriptwriter ${roleCalls(db, runId, 'scriptwriter').length}, generator ${roleCalls(db, runId, 'generator').length}), ` +
        `$${u.costUsd.toFixed(4)}; input ${u.inCached} cached + ${u.inUncached} uncached, output ${u.out} (${u.reasoning} reasoning); ` +
        `${((Date.now() - started) / 1000).toFixed(0)} s; saved v${result.version}`,
    );
    console.log(`  files -> ${relative(config.workspaceRoot, dataDir)}`);
    return 0;
  } finally {
    await tts.provider.close();
    closeDatabase(db);
  }
}

process.exitCode = await main();
