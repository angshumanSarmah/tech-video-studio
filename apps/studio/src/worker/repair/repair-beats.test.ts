import { join } from 'node:path';
import {
  SettingsSchema,
  type GeneratorOutput,
  type RenderableVideoSpec,
  type RepairRequest,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { enqueueJob, listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { fixtureResponsesDir, fixtureRunSettings, fixtureTopic } from '../agents/fixture-topics.ts';
import {
  fixtureGeneratedSpec,
  recordedBoards,
  recordedScript,
} from '../agents/generator/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import { seedRunWithUploads } from '../agents/researcher/testing.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from '../jobs/direct.ts';
import { ingestJobHandler } from '../jobs/ingest.ts';
import { createJobRegistry } from '../jobs/registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from '../jobs/research.ts';
import { createLlmClient } from '../llm/client.ts';
import {
  dryRunTransport,
  recordedInOrder,
  type DryRunFixtures,
  type DryRunResponse,
} from '../llm/dry-run.ts';
import { runNextJob } from '../runner.ts';
import { repairBeats } from './repair-beats.ts';
import { fixtureTts, type FixtureTts } from './testing.ts';

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});
const researcher = recordedInOrder(fixtureResponsesDir('researcher', 'rate-limiter'), 'researcher');
const director = recordedInOrder(fixtureResponsesDir('director', 'rate-limiter'), 'director');

let t: TestDb;
let tts: FixtureTts;

beforeEach(() => {
  t = createTestDb();
  tts = fixtureTts('rate-limiter', join(t.dataDir, 'fake-tts'));
});

afterEach(() => t.cleanup());

const answer = (value: unknown): DryRunResponse => ({
  content: JSON.stringify(value),
  servedModel: 'recorded',
  finishReason: 'stop',
  usage: null,
});

function client(fixtures: DryRunFixtures) {
  return createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: dryRunTransport({ researcher, director, ...fixtures }),
  });
}

/** The rate limiter's run with research and plan replayed, and its finished spec as v1. */
async function fixtureRun(): Promise<{ runId: number; specVersionId: number }> {
  const llm = client({});
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings };
  const reg = createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
  ]);
  const { topic, sourceFiles, seriesTag } = fixtureTopic('rate-limiter');
  const { runId } = seedRunWithUploads(t.db, t.dataDir, topic, sourceFiles, {
    seriesTag,
    settings: fixtureRunSettings(),
  });
  const next = () =>
    runNextJob({ db: t.db, registry: reg, workerId: 't', signal: new AbortController().signal });
  await next();
  for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
    enqueueJob(t.db, { type, runId });
    await next();
  }
  expect(listRunJobs(t.db, runId).every((j) => j.status === 'done')).toBe(true);
  const spec = fixtureGeneratedSpec('rate-limiter');
  const saved = saveSpecVersion(t.db, t.dataDir, { runId, spec, createdBy: 'agent' });
  return { runId, specVersionId: saved.version.id };
}

/** The Scriptwriter's recorded beat with a new narration, as a one-beat answer. */
function revisedBeat(beatId: string, from: string, to: string): DryRunResponse {
  const beat = recordedScript('rate-limiter').script.find((b) => b.beatId === beatId)!;
  expect(beat.narration).toContain(from);
  return answer({ script: [{ ...beat, narration: beat.narration.replace(from, to) }] });
}

const narrationRequest = (beatId: string): RepairRequest => ({
  beatId,
  owner: 'scriptwriter',
  fields: ['narration'],
  issues: [{ code: 'beat_over_target', message: '<example-message>' }],
});

function repair(
  fixtures: DryRunFixtures,
  runId: number,
  specVersionId: number,
  requests: RepairRequest[],
) {
  return repairBeats(
    { db: t.db, dataDir: t.dataDir, llm: client(fixtures), prompts, tts: tts.provider, settings },
    { runId, specVersionId, requests, signal: new AbortController().signal, log: () => undefined },
  );
}

const savedSpec = (id: number) =>
  readDataJson(t.dataDir, getSpecVersion(t.db, id)!.jsonPath) as RenderableVideoSpec;

const roleCalls = (runId: number, role: string) =>
  listRunLlmCalls(t.db, runId).filter((c) => c.role === role).length;

/** Each beat's script and board, for comparing beats a repair should not touch. */
const beatParts = (spec: RenderableVideoSpec, beatId: string) =>
  JSON.stringify([
    spec.script.find((s) => s.beatId === beatId),
    spec.scenes.find((s) => s.beatId === beatId),
  ]);

const TRIM = ['In March twenty twenty-five, Larkspur', 'Larkspur'] as const;

describe('repairBeats', () => {
  it('trims a narration whose anchors all survive: remapped, no Generator call', async () => {
    const { runId, specVersionId } = await fixtureRun();
    const before = savedSpec(specVersionId);
    const result = await repair(
      { scriptwriter: [revisedBeat('beat1', ...TRIM)] },
      runId,
      specVersionId,
      [narrationRequest('beat1')],
    );
    expect(result.beats).toEqual([
      expect.objectContaining({ beatId: 'beat1', script: 'revised', board: 'remapped' }),
    ]);
    expect(roleCalls(runId, 'generator')).toBe(0);
    expect(roleCalls(runId, 'scriptwriter')).toBe(1);
    const after = savedSpec(result.specVersionId);
    expect(after.script[0]?.narration.startsWith('Larkspur Pay checkout failed')).toBe(true);
    // Every anchor moved back by the four words the trim removed.
    const shift = (spec: RenderableVideoSpec) =>
      spec.scenes[0]!.events.map((e) => (e.at.type === 'word' ? e.at.index : -1));
    expect(shift(after)).toEqual(shift(before).map((i) => i - 4));
    for (const beat of before.story.beats.slice(1)) {
      expect(beatParts(after, beat.id)).toBe(beatParts(before, beat.id));
    }
    // Only the changed narration was new to the TTS; the rest were cache hits.
    expect(tts.calls.filter((text) => !before.script.some((s) => s.narration === text))).toEqual([
      after.script[0]?.narration,
    ]);
  });

  it('redraws a beat that lost an anchored word, then the later beat its new board broke', async () => {
    const { runId, specVersionId } = await fixtureRun();
    const before = savedSpec(specVersionId);
    const boards = recordedBoards('rate-limiter');
    const result = await repair(
      {
        scriptwriter: [
          revisedBeat(
            'beat3',
            'a client gets twenty-four times its limit.',
            'a client gets far more than its limit.',
          ),
        ],
        generator: {
          beat3: [answer(renamedStore(shiftedBoard(boards.beat3!, 17, 1)))],
          beat4: [answer(renamedStore(boards.beat4!))],
        },
      },
      runId,
      specVersionId,
      [narrationRequest('beat3')],
    );
    expect(result.beats.map((b) => [b.beatId, b.script, b.board, b.lost])).toEqual([
      ['beat3', 'revised', 'redrawn', ['twenty-four']],
      ['beat4', 'kept', 'redrawn', undefined],
    ]);
    expect(roleCalls(runId, 'generator')).toBe(2);
    const after = savedSpec(result.specVersionId);
    expect(after.scenes[2]?.elements.map((e) => e.id)).toContain('shared_store');
    for (const beat of before.story.beats.filter((b) => b.id !== 'beat3' && b.id !== 'beat4')) {
      expect(beatParts(after, beat.id)).toBe(beatParts(before, beat.id));
    }
  });

  it('resumes after a crash, reusing the finished revision, and reruns as a no-op', async () => {
    const { runId, specVersionId } = await fixtureRun();
    const trimmed = recordedScript('rate-limiter').script[0]!.narration.replace(...TRIM);
    tts.failOnce(trimmed);
    const fixtures = { scriptwriter: [revisedBeat('beat1', ...TRIM)] };
    await expect(
      repair(fixtures, runId, specVersionId, [narrationRequest('beat1')]),
    ).rejects.toThrow('TTS crashed');
    expect(roleCalls(runId, 'scriptwriter')).toBe(1);
    const resumed = await repair(fixtures, runId, specVersionId, [narrationRequest('beat1')]);
    expect(roleCalls(runId, 'scriptwriter')).toBe(1);
    expect(resumed.created).toBe(true);
    const again = await repair(fixtures, runId, specVersionId, [narrationRequest('beat1')]);
    expect(roleCalls(runId, 'scriptwriter')).toBe(1);
    expect(again.created).toBe(false);
    expect(again.version).toBe(resumed.version);
  });
});

/** The recorded board with word anchors from `from` on moved by `by` (a narration grew). */
function shiftedBoard(board: GeneratorOutput, from: number, by: number): GeneratorOutput {
  const copy = structuredClone(board);
  for (const event of copy.events) {
    if (event.at.type === 'word' && event.at.index > from) event.at.index += by;
  }
  return copy;
}

/** The board with the shared store's element renamed: what the next beat of the board uses. */
function renamedStore(board: GeneratorOutput): GeneratorOutput {
  const json = JSON.stringify(board).replaceAll('"store_node"', '"shared_store"');
  return JSON.parse(json) as GeneratorOutput;
}
