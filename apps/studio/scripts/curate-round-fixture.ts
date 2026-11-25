/**
 * `pnpm --filter @explainer-studio/studio curate-round:fixture [--topic <id>] [--record]
 * [--timeout <sec>]` (P1C.9 step 5): records one Curator review-plus-repair round for a fixture
 * topic, the answers the orchestrator's dry run (`worker/orchestrator.test.ts`) replays so a run
 * passes gate 3 with the real Curator. It runs the topic from sources to the end through the
 * orchestrator and the real job handlers, every gate on auto, exactly as that test does (the
 * committed Kokoro timing, `fixtureTts`; a fake renderer), in a scratch data dir
 * (`<DATA_DIR>/curate-round/fixture/<topic>/`, rebuilt each run). The Researcher, Director,
 * Scriptwriter and Generator replay their recordings; the Curator is live, and so are the
 * Scriptwriter and the Generator once their recordings run out (the repairs the Curator sends
 * them). Prints the curation and where the run stopped. With `--record`, and only when the run
 * passed gate 3 with nothing blocking, writes the Curator's calls and the repairs' answers to
 * `agents/curator/fixtures/<topic>/round/` (`curator.json`, `scriptwriter.json` in call order,
 * `generator.json` per beat), which `curateRound(topic)` loads.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelRole } from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { closeDatabase, migrationsDirFor, openDatabase, type Db } from '#core/db/client.ts';
import { prepareDatabase } from '#core/db/prepare.ts';
import { getGate } from '#core/db/repositories/gates.ts';
import { listRunLlmCalls, type LlmCallRow } from '#core/db/repositories/llm-calls.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { advanceRun } from '#core/orchestrator/advance.ts';
import { latestCuration } from '#core/services/curation.ts';
import { curateRoundDir } from '#worker/agents/curator/testing.ts';
import { fixtureResponsesDir, fixtureRunSettings } from '#worker/agents/fixture-topics.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '#worker/agents/prompts/templates.ts';
import { seedRunWithUploads } from '#worker/agents/researcher/testing.ts';
import { createJobHandlers, createJobRegistry } from '#worker/jobs/registry.ts';
import {
  createLlmClient,
  createLlmTransport,
  DryRunExhaustedError,
  dryRunTransport,
  loadDryRunFixtures,
  type LlmTransport,
} from '#worker/llm/index.ts';
import { fakeTools } from '#worker/render/testing.ts';
import { fixtureTts } from '#worker/repair/testing.ts';
import { runNextJob } from '#worker/runner.ts';
import { printAttempts, recordKeyedResponses, recordResponses, topicArg } from './agent-fixture.ts';

const AUTO = { research: true, beat_sheet: true, scenes: true, draft: true };
const REPLAYED = ['researcher', 'director', 'scriptwriter', 'generator'] as const;
const replays = (role: ModelRole) => (REPLAYED as readonly ModelRole[]).includes(role);

function withTimeout(config: AppConfig): AppConfig {
  const i = process.argv.indexOf('--timeout');
  if (i < 0) return config;
  return { ...config, llm: { ...config.llm, requestTimeoutSec: Number(process.argv[i + 1]) } };
}

/** Replays a role's recordings while they last, then calls the model; the Curator always live. */
function replayThenLive(config: AppConfig, topicId: Parameters<typeof fixtureResponsesDir>[1]) {
  const recorded = dryRunTransport(
    Object.fromEntries(
      REPLAYED.map((role) => [
        role,
        loadDryRunFixtures(fixtureResponsesDir(role, topicId))[role] ?? [],
      ]),
    ),
  );
  const live = createLlmTransport(config.llm);
  const transport: LlmTransport = {
    send: async (request) => {
      if (!replays(request.role)) return live.send(request);
      try {
        return await recorded.send(request);
      } catch (error) {
        if (error instanceof DryRunExhaustedError) return live.send(request);
        throw error;
      }
    },
  };
  return transport;
}

async function drain(db: Db, dataDir: string, registry: ReturnType<typeof createJobRegistry>) {
  const signal = new AbortController().signal;
  const advance = (tx: Parameters<typeof advanceRun>[0], runId: number) =>
    advanceRun(tx, dataDir, runId);
  while (await runNextJob({ db, registry, workerId: 'curate-round', signal, advance })) {
    // the orchestrator queued the next job, if any
  }
}

/** The calls made from the Curator's first one on: the review and its repairs. */
function curationCalls(calls: readonly LlmCallRow[]): LlmCallRow[] {
  const first = calls.findIndex((c) => c.role === 'curator');
  return first < 0 ? [] : calls.slice(first);
}

async function main(): Promise<number> {
  const config = withTimeout(loadConfig());
  const topic = topicArg(process.argv);
  const record = process.argv.includes('--record');
  const dataDir = join(config.dataDir, 'curate-round', 'fixture', topic.id);
  rmSync(dataDir, { recursive: true, force: true });
  const { dbPath } = prepareDatabase(dataDir, migrationsDirFor(config.workspaceRoot));
  const db = openDatabase(dbPath);
  try {
    const { runId } = seedRunWithUploads(db, dataDir, topic.topic, topic.sourceFiles, {
      seriesTag: topic.seriesTag,
      app: config,
      settings: fixtureRunSettings({ autoApprove: AUTO }),
    });
    const llm = createLlmClient({
      db,
      dataDir,
      llm: config.llm,
      transport: replayThenLive(config, topic.id),
    });
    const prompts = loadPromptTemplates(join(config.workspaceRoot, PROMPTS_DIR));
    const tts = fixtureTts(topic.id, join(dataDir, 'fake-tts')).provider;
    const { tools } = fakeTools();
    const registry = createJobRegistry(
      createJobHandlers({ db, dataDir, tools, tts, llm, prompts }),
    );
    await drain(db, dataDir, registry);

    const run = getRun(db, runId)!;
    const curation = latestCuration(db, dataDir, runId);
    const scenes = getGate(db, runId, 'scenes');
    console.log(`Run ${runId}: ${run.status} at ${run.pipelineStep}.`);
    console.log(`Scenes gate: ${scenes?.status ?? 'not reached'} (${scenes?.decidedBy ?? '-'}).`);
    const calls = curationCalls(listRunLlmCalls(db, runId));
    for (const role of ['curator', 'scriptwriter', 'generator'] as const) {
      const own = calls.filter((c) => c.role === role);
      const cost = own.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
      console.log(`  ${role}: ${own.length} call(s), $${cost.toFixed(4)}`);
      printAttempts(dataDir, own);
    }
    if (curation) {
      const { report } = curation;
      console.log(
        `Curation: ${report.rounds.length} round(s), stopped: ${report.stop}, ` +
          `blocking: ${report.blocking}, $${report.cost.totalUsd.toFixed(4)}.`,
      );
      for (const round of report.rounds) {
        console.log(
          `  round ${round.round}: ${round.blockingBefore.join(', ') || '-'} -> ` +
            `${round.blockingAfter.join(', ') || '-'}`,
        );
      }
      for (const badge of report.badges) {
        console.log(
          `  [${badge.severity}] ${badge.beatId ?? 'video'} ${badge.code}: ${badge.message}`,
        );
      }
    }
    if (!record) return 0;
    const passed = scenes?.status === 'approved' && curation?.report.blocking === false;
    if (!passed) {
      console.error('Not recorded: the run did not pass gate 3 with nothing blocking.');
      return 1;
    }
    const dir = curateRoundDir(topic.id);
    const counts = [
      recordResponses(
        dataDir,
        calls.filter((c) => c.role === 'curator'),
        dir,
        'curator',
      ),
      recordResponses(
        dataDir,
        calls.filter((c) => c.role === 'scriptwriter'),
        dir,
        'scriptwriter',
      ),
      recordKeyedResponses(
        dataDir,
        calls.filter((c) => c.role === 'generator'),
        dir,
        'generator',
      ),
    ];
    console.log(
      `Recorded ${counts.join(' / ')} curator / scriptwriter / generator answers in ${dir}.`,
    );
    return 0;
  } finally {
    closeDatabase(db);
  }
}

process.exitCode = await main();
