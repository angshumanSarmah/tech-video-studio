import { join } from 'node:path';
import {
  DEFAULT_REGISTRIES,
  specLayoutWarnings,
  withRegistryChecks,
} from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  GeneratorBeatInputSchema,
  GeneratorBeatOutputSchema,
  SettingsSchema,
  validateRenderableVideoSpec,
  validateVideoSpec,
  type VideoSpec,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMissingAssets } from '#core/assets/render-assets.ts';
import { readDataJson } from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { doneBeatSteps, getRunStep } from '#core/db/repositories/run-steps.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestGeneration } from '#core/services/generation.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { DIRECTOR_RESPONSES_DIR } from '../agents/director/testing.ts';
import {
  FIXTURE_TOPIC_IDS,
  fixtureResponsesDir,
  fixtureTopic,
  type FixtureTopicId,
} from '../agents/fixture-topics.ts';
import {
  failoverBoard,
  fixtureScriptedSpec,
  hookBoard,
  rateLimiterBoards,
  storeBoard,
  countBoard,
  type FixtureBoard,
} from '../agents/generator/testing.ts';
import { loadTimingFixture, withFixtureTiming } from '../agents/generator/timing-fixture.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import {
  RATE_LIMITER_RESPONSES_DIR,
  RATE_LIMITER_SOURCE_FILES,
  RATE_LIMITER_TOPIC,
  seedRunWithUploads,
} from '../agents/researcher/testing.ts';
import { createLlmClient } from '../llm/client.ts';
import {
  dryRunTransport,
  loadDryRunFixtures,
  recordedInOrder,
  type DryRunResponse,
} from '../llm/dry-run.ts';
import type { LlmTransport, TokenUsage } from '../llm/types.ts';
import { runNextJob } from '../runner.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from './direct.ts';
import { GENERATE_JOB_TYPE, generateJobHandler } from './generate.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry, type JobRegistry } from './registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './research.ts';

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});
const researcher = recordedInOrder(RATE_LIMITER_RESPONSES_DIR, 'researcher');
const director = recordedInOrder(DIRECTOR_RESPONSES_DIR, 'director');
/** A fixed peak-time clock, so costs do not depend on when the test runs. */
const NOW = new Date('2026-11-24T08:00:00Z');
/** Output tokens per hand-written answer (reasoning included): the plan's estimate. */
const OUT_TOKENS = 8_000;

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

type GeneratorAnswers = Record<string, readonly DryRunResponse[]>;

const answer = (board: FixtureBoard | object): DryRunResponse => ({
  content: JSON.stringify(board),
});

/** Every beat's clean hand-written board, one answer each. */
function cleanAnswers(): GeneratorAnswers {
  return Object.fromEntries(
    Object.entries(rateLimiterBoards()).map(([beatId, board]) => [beatId, [answer(board)]]),
  );
}

/** A board that fails its own checks (no motion, no focus): three of them exhaust the repairs. */
const empty = answer({ elements: [] });

interface SentCall {
  readonly beatId: string | undefined;
  readonly event: 'start' | 'end';
}

/**
 * The dry run with a provider prefix cache imitated: a call hits the cache for its system
 * message only when an earlier call with the same one has finished (DeepSeek writes the cache
 * when a request completes); tokens are estimated at 3.5 characters each. Records start and end
 * order.
 */
function cachingTransport(inner: LlmTransport, sent: SentCall[]): LlmTransport {
  const cached = new Set<string>();
  const tokens = (text: string) => Math.ceil(text.length / 3.5);
  return {
    async send(request) {
      sent.push({ beatId: request.replayKey, event: 'start' });
      const response = await inner.send(request);
      const [system, ...rest] = request.messages;
      const prefix = system?.content ?? '';
      const restTokens = tokens(rest.map((m) => m.content).join(''));
      const hit = request.role === 'generator' && cached.has(prefix);
      const inCached = hit ? tokens(prefix) : 0;
      const inUncached = restTokens + (hit ? 0 : tokens(prefix));
      if (request.role === 'generator') cached.add(prefix);
      sent.push({ beatId: request.replayKey, event: 'end' });
      if (request.role !== 'generator') return response;
      const usage: TokenUsage = { inCached, inUncached, out: OUT_TOKENS, reasoning: 6_000 };
      const rawUsage = {
        prompt_tokens: inCached + inUncached,
        completion_tokens: OUT_TOKENS,
        prompt_cache_hit_tokens: inCached,
        prompt_cache_miss_tokens: inUncached,
        completion_tokens_details: { reasoning_tokens: 6_000 },
      };
      return { ...response, usage, rawUsage };
    },
  };
}

function registry(generator: GeneratorAnswers, sent: SentCall[] = []): JobRegistry {
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: cachingTransport(dryRunTransport({ researcher, director, generator }), sent),
    now: () => NOW,
  });
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings };
  return createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    generateJobHandler(deps),
  ]);
}

async function runNext(reg: JobRegistry): Promise<void> {
  await runNextJob({
    db: t.db,
    registry: reg,
    workerId: 'test:1',
    signal: new AbortController().signal,
  });
}

/** A run with research and a plan (replayed), and the fixture's plan + script as spec v1. */
async function scripted(edit: (spec: VideoSpec) => VideoSpec = (s) => s) {
  const reg = registry({});
  const { runId } = seedRunWithUploads(
    t.db,
    t.dataDir,
    RATE_LIMITER_TOPIC,
    RATE_LIMITER_SOURCE_FILES,
  );
  await runNext(reg);
  enqueueJob(t.db, { type: RESEARCH_JOB_TYPE, runId });
  await runNext(reg);
  enqueueJob(t.db, { type: DIRECT_JOB_TYPE, runId });
  await runNext(reg);
  const spec = validateVideoSpec(fixtureScriptedSpec('rate-limiter')).spec!;
  const saved = saveSpecVersion(t.db, t.dataDir, { runId, spec: edit(spec), createdBy: 'agent' });
  return { runId, specVersionId: saved.version.id };
}

async function generate(
  reg: JobRegistry,
  runId: number,
  payload: { specVersionId: number; beatId?: string; feedback?: string },
) {
  const job = enqueueJob(t.db, { type: GENERATE_JOB_TYPE, runId, payload });
  await runNext(reg);
  return getJob(t.db, job.id)!;
}

function generatorCalls(runId: number) {
  return listRunLlmCalls(t.db, runId).filter((c) => c.role === 'generator');
}

function logs(runId: number) {
  return listEventsSince(t.db, { runId, afterId: 0, limit: 500 })
    .filter((e) => e.type === 'log')
    .map((e) => e.payload as { level: string; message: string });
}

function latestSpec(runId: number): VideoSpec {
  const version = getLatestSpecVersion(t.db, runId)!;
  return validateVideoSpec(readDataJson(t.dataDir, version.jsonPath)).spec!;
}

function userMessageOf(promptPath: string): string {
  const prompt = readDataJson(t.dataDir, promptPath) as { messages: { content: string }[] };
  return prompt.messages[1]?.content ?? '';
}

describe('generate job (rate-limiter fixture, hand-written boards, dry run)', () => {
  it('draws every beat into valid, layout-clean scenes and saves them as the next version', async () => {
    const { runId, specVersionId } = await scripted();
    const sent: SentCall[] = [];
    const job = await generate(registry(cleanAnswers(), sent), runId, { specVersionId });
    expect(job.status).toBe('done');

    const spec = latestSpec(runId);
    expect(spec.scenes?.map((s) => s.beatId)).toEqual(spec.story.beats.map((b) => b.id));
    const renderable = validateRenderableVideoSpec(spec);
    const checked = withRegistryChecks(renderable, spec, DEFAULT_REGISTRIES);
    expect(checked.errors).toEqual([]);
    expect(checked.warnings.filter((w) => w.path.startsWith('$.scenes'))).toEqual([]);
    expect(specLayoutWarnings(checked.spec!, getTheme())).toEqual([]);

    const generation = latestGeneration(t.db, t.dataDir, runId)!;
    expect(generation.output.warnings).toEqual([]);
    expect(generation.output.beats.every((b) => b.outcome === 'generated' && !b.retried)).toBe(
      true,
    );
    expect(generation.output.usage.calls).toBe(8);
    expect(readMissingAssets(t.dataDir, runId)).toEqual([]);
  });

  it('runs one warm-up call alone, then the rest; every later call hits the cached prefix', async () => {
    const { runId, specVersionId } = await scripted();
    const sent: SentCall[] = [];
    await generate(registry(cleanAnswers(), sent), runId, { specVersionId });
    expect(sent.slice(0, 2)).toEqual([
      { beatId: 'beat1', event: 'start' },
      { beatId: 'beat1', event: 'end' },
    ]);
    // beat4 continues beat3's board: it starts only after beat3 has finished.
    const at = (beatId: string, event: SentCall['event']) =>
      sent.findIndex((s) => s.beatId === beatId && s.event === event);
    expect(at('beat4', 'start')).toBeGreaterThan(at('beat3', 'end'));
    const calls = generatorCalls(runId);
    expect(calls.filter((c) => c.tokensInCached === 0)).toHaveLength(1);
    const summary = logs(runId).find((l) => l.message.startsWith('Generator:'));
    expect(summary?.message).toMatch(/8 boards \(8 drawn, 0 reused, 0 kept, 0 retried\)/);
    expect(summary?.message).toMatch(/8 calls, \$\d+\.\d{4}; cache hit [\d,]+ of [\d,]+ input/);
    console.info(summary?.message);
  });

  it('writes a step per beat with its input hash and board, and the job step with the result', async () => {
    const { runId, specVersionId } = await scripted();
    await generate(registry(cleanAnswers()), runId, { specVersionId });
    const [step] = doneBeatSteps(t.db, runId, 'generate', 'beat4');
    expect(step).toMatchObject({ stage: 'generate', beatId: 'beat4', status: 'done' });
    const input = GeneratorBeatInputSchema.parse(readDataJson(t.dataDir, step!.inputPath!));
    expect(input).toMatchObject({ beatId: 'beat4', beatIndex: 3, reason: 'generate' });
    expect(input.promptVersion).toBe('generator@v2');
    const output = GeneratorBeatOutputSchema.parse(readDataJson(t.dataDir, step!.outputPath!));
    expect(output.scene).toMatchObject({ beatId: 'beat4', continuesPrevious: true });
    // The continuing beat was shown what beat3 left on screen.
    const call = generatorCalls(runId).find((c) => c.stepId === step!.id)!;
    expect(userMessageOf(call.promptPath)).toContain('- own (node_card) "Own bucket": present;');

    const generation = latestGeneration(t.db, t.dataDir, runId)!;
    expect(generation.step.beatId).toBeNull();
    expect(generation.input.specVersionId).toBe(specVersionId);
    expect(generation.output.specVersionId).toBe(getLatestSpecVersion(t.db, runId)!.id);
  });

  it('resumes: a job that failed on one beat keeps the others, and the next job reuses them', async () => {
    const { runId, specVersionId } = await scripted();
    const failing = { ...cleanAnswers(), beat6: [empty, empty, empty] };
    const first = await generate(registry(failing), runId, { specVersionId });
    expect(first.status).toBe('failed');
    expect(doneBeatSteps(t.db, runId, 'generate', 'beat5')).toHaveLength(1);
    expect(doneBeatSteps(t.db, runId, 'generate', 'beat6')).toHaveLength(0);
    const callsBefore = generatorCalls(runId).length;

    // Only beat6 is recorded: any other call would run out of answers and fail the job.
    const second = await generate(registry({ beat6: [answer(failoverBoard())] }), runId, {
      specVersionId,
    });
    expect(second.status).toBe('done');
    expect(generatorCalls(runId).length - callsBefore).toBe(1);
    const beats = latestGeneration(t.db, t.dataDir, runId)!.output.beats;
    expect(beats.filter((b) => b.outcome === 'reused').map((b) => b.beatId)).toEqual([
      'beat1',
      'beat2',
      'beat3',
      'beat4',
      'beat5',
      'beat7',
      'beat8',
    ]);
    expect(beats.find((b) => b.beatId === 'beat6')?.outcome).toBe('generated');
  });

  it('regenerates one beat with its feedback and keeps every other board', async () => {
    const { runId, specVersionId } = await scripted();
    await generate(registry(cleanAnswers()), runId, { specVersionId });
    const v2 = getLatestSpecVersion(t.db, runId)!;
    const before = generatorCalls(runId).length;

    const redo = await generate(registry({ beat3: [answer(storeBoard())] }), runId, {
      specVersionId: v2.id,
      beatId: 'beat3',
      feedback: 'Bring the shared store in earlier.',
    });
    expect(redo.status).toBe('done');
    const calls = generatorCalls(runId).slice(before);
    expect(calls).toHaveLength(1);
    expect(userMessageOf(calls[0]!.promptPath)).toContain(
      '## FEEDBACK (draw this board again and fix this)\nBring the shared store in earlier.',
    );
    const beats = latestGeneration(t.db, t.dataDir, runId)!.output.beats;
    expect(beats.filter((b) => b.outcome !== 'kept').map((b) => b.beatId)).toEqual(['beat3']);
  });

  it('redraws a later beat of the chain only when the regenerated board breaks it', async () => {
    const { runId, specVersionId } = await scripted();
    await generate(registry(cleanAnswers()), runId, { specVersionId });
    const v2 = getLatestSpecVersion(t.db, runId)!;
    const before = generatorCalls(runId).length;

    // The new beat3 board renames "own": beat4's board acts on an id that is gone.
    const rename = (board: FixtureBoard) =>
      JSON.parse(JSON.stringify(board).replaceAll('"own"', '"local"')) as FixtureBoard;
    const renamed = rename(storeBoard());
    const fixed = rename(countBoard());
    const redo = await generate(
      registry({ beat3: [answer(renamed)], beat4: [answer(fixed)] }),
      runId,
      { specVersionId: v2.id, beatId: 'beat3' },
    );
    expect(redo.status).toBe('done');
    expect(generatorCalls(runId).length - before).toBe(2);
    const beats = latestGeneration(t.db, t.dataDir, runId)!.output.beats;
    expect(beats.filter((b) => b.outcome !== 'kept').map((b) => b.beatId)).toEqual([
      'beat3',
      'beat4',
    ]);
    const step = getRunStep(t.db, beats.find((b) => b.beatId === 'beat4')!.stepId!)!;
    const input = GeneratorBeatInputSchema.parse(readDataJson(t.dataDir, step.inputPath!));
    expect(input.reason).toBe('revalidate');
    expect(logs(runId).some((l) => /Beat beat4 no longer fits beat beat3/.test(l.message))).toBe(
      true,
    );
  });

  describe('post-pass across boards', () => {
    /** Beats 1 and 6 without tags, so a board of only their stat card passes its own checks. */
    const untagged = (spec: VideoSpec): VideoSpec => ({
      ...spec,
      script: spec.script?.map((s) =>
        s.beatId === 'beat1' || s.beatId === 'beat6' ? { ...s, tags: [] } : s,
      ),
    });
    const statOnly = (board: FixtureBoard): FixtureBoard => {
      const card = board.elements.find((e) => e.primitive === 'stat_card')!;
      const enter = board.events.find((e) => e.targets.includes(card.id))!;
      return { elements: [card], events: [enter], focus: [card.id] };
    };
    const withoutTags = (board: FixtureBoard): FixtureBoard => {
      const tags = new Set(board.elements.filter((e) => e.primitive === 'tag').map((e) => e.id));
      return {
        elements: board.elements.filter((e) => !tags.has(e.id)),
        events: board.events
          .map((e) => ({ ...e, targets: e.targets.filter((id) => !tags.has(id)) }))
          .filter((e) => e.targets.length > 0),
        focus: board.focus,
      };
    };
    /** beat1 and beat6 both only a stat card: the second static board (beat6) fails. */
    const staticAnswers = (beat6: readonly DryRunResponse[]) => ({
      ...cleanAnswers(),
      beat1: [answer(statOnly(hookBoard()))],
      beat6,
    });

    it('retries a beat that fails a check across boards once, with the issue as feedback', async () => {
      const { runId, specVersionId } = await scripted(untagged);
      const answers = staticAnswers([
        answer(statOnly(failoverBoard())),
        answer(withoutTags(failoverBoard())),
      ]);
      const job = await generate(registry(answers), runId, { specVersionId });
      expect(job.status).toBe('done');
      const output = latestGeneration(t.db, t.dataDir, runId)!.output;
      expect(output.beats.filter((b) => b.retried).map((b) => b.beatId)).toEqual(['beat6']);
      expect(output.warnings).toEqual([]);
      const retry = generatorCalls(runId).at(-1)!;
      expect(userMessageOf(retry.promptPath)).toMatch(/## FEEDBACK[\s\S]*At most 1 beat may show/);
    });

    describe('inside a chain (beat7 continues beat6)', () => {
      /** Beats 1, 6 and 7 untagged and beat7 on beat6's board: stat-card-only 1 and 6 are static. */
      const chained = (spec: VideoSpec): VideoSpec => ({
        ...spec,
        story: {
          ...spec.story,
          beats: spec.story.beats.map((b) =>
            b.id === 'beat7' ? { ...b, continuesPrevious: true } : b,
          ),
        },
        script: spec.script?.map((s) =>
          ['beat1', 'beat6', 'beat7'].includes(s.beatId) ? { ...s, tags: [] } : s,
        ),
      });
      const word = (index: number) => ({ type: 'word', index }) as const;
      const slow = failoverBoard().elements.find((e) => e.id === 'slow')!;
      const replica = failoverBoard().elements.find((e) => e.id === 'replica')!;
      /** beat6's retry: the stat card with the replica beside it (not static), kept or renamed. */
      const retried = (cardId: string): FixtureBoard => ({
        elements: [replica, { ...slow, id: cardId }],
        events: [
          { at: word(9), action: 'enter', targets: ['replica'] },
          { at: word(20), action: 'enter', targets: [cardId] },
        ],
        focus: [cardId],
      });
      /** beat7 on beat6's board: a provider card of its own, and a pulse on beat6's card. */
      const continuing = (cardId: string): FixtureBoard => ({
        elements: [
          {
            id: 'provider',
            primitive: 'node_card',
            props: { title: 'Payment provider', icon: 'credit_card' },
          },
        ],
        events: [
          { at: word(4), action: 'pulse', targets: [cardId] },
          { at: word(24), action: 'enter', targets: ['provider'] },
        ],
        focus: ['provider'],
      });
      const answers = (retry: FixtureBoard, beat7: readonly FixtureBoard[]) => ({
        ...cleanAnswers(),
        beat1: [answer(statOnly(hookBoard()))],
        beat6: [answer(statOnly(failoverBoard())), answer(retry)],
        beat7: beat7.map(answer),
      });

      it('redraws a later beat when the retry renames an element it uses', async () => {
        const { runId, specVersionId } = await scripted(chained);
        const reg = registry(answers(retried('late'), [continuing('slow'), continuing('late')]));
        const job = await generate(reg, runId, { specVersionId });
        expect(job.status).toBe('done');
        const output = latestGeneration(t.db, t.dataDir, runId)!.output;
        expect(output.beats.filter((b) => b.retried).map((b) => b.beatId)).toEqual(['beat6']);
        expect(output.warnings).toEqual([]);
        expect(generatorCalls(runId)).toHaveLength(10);
        const beat7 = output.beats.find((b) => b.beatId === 'beat7')!;
        const step = getRunStep(t.db, beat7.stepId!)!;
        const input = GeneratorBeatInputSchema.parse(readDataJson(t.dataDir, step.inputPath!));
        expect(input.reason).toBe('revalidate');
        expect(latestSpec(runId).scenes?.[6]?.events[0]?.targets).toEqual(['late']);
        expect(
          logs(runId).some((l) =>
            /Beat beat7 no longer fits beat beat6's new board/.test(l.message),
          ),
        ).toBe(true);
      });

      it('makes no extra call when the retry leaves what later beats use', async () => {
        const { runId, specVersionId } = await scripted(chained);
        const job = await generate(
          registry(answers(retried('slow'), [continuing('slow')])),
          runId,
          {
            specVersionId,
          },
        );
        expect(job.status).toBe('done');
        // 8 beats plus beat6's retry; beat7 keeps its first board.
        expect(generatorCalls(runId)).toHaveLength(9);
        const output = latestGeneration(t.db, t.dataDir, runId)!.output;
        expect(output.warnings).toEqual([]);
        const step = getRunStep(t.db, output.beats.find((b) => b.beatId === 'beat7')!.stepId!)!;
        const input = GeneratorBeatInputSchema.parse(readDataJson(t.dataDir, step.inputPath!));
        expect(input.reason).toBe('generate');
      });
    });

    it('sends what the retry could not fix to gate 3 as warnings', async () => {
      const { runId, specVersionId } = await scripted(untagged);
      const still = answer(statOnly(failoverBoard()));
      const job = await generate(registry(staticAnswers([still, still, still, still])), runId, {
        specVersionId,
      });
      expect(job.status).toBe('done');
      const output = latestGeneration(t.db, t.dataDir, runId)!.output;
      expect(output.warnings).toEqual([
        expect.objectContaining({ beatId: 'beat6', code: 'static_beats', soft: false }),
      ]);
      expect(logs(runId).some((l) => /beat6: the retry still failed/.test(l.message))).toBe(true);
    });
  });

  it('swaps near-identical asset ids (logged), and records unknown ones as missing assets', async () => {
    const { runId, specVersionId } = await scripted();
    const boards = rateLimiterBoards();
    const swapped = JSON.parse(
      JSON.stringify(boards.beat1).replace('"shopping_bag"', '"Shopping-Bag"'),
    ) as FixtureBoard;
    const unknown = JSON.parse(
      JSON.stringify(boards.beat2).replace('"icon":"key"', '"icon":"vault_door"'),
    ) as FixtureBoard;
    const answers = { ...cleanAnswers(), beat1: [answer(swapped)], beat2: [answer(unknown)] };
    const job = await generate(registry(answers), runId, { specVersionId });
    expect(job.status).toBe('done');

    const [step] = doneBeatSteps(t.db, runId, 'generate', 'beat1');
    const output = GeneratorBeatOutputSchema.parse(readDataJson(t.dataDir, step!.outputPath!));
    expect(output.swaps).toEqual([
      { path: '$.elements[0].props.icon', from: 'Shopping-Bag', to: 'shopping_bag' },
    ]);
    expect(
      logs(runId).some((l) => l.message.includes('"Shopping-Bag" read as "shopping_bag"')),
    ).toBe(true);
    expect(readMissingAssets(t.dataDir, runId).map((m) => m.id)).toEqual(['vault_door']);
    const warnings = latestGeneration(t.db, t.dataDir, runId)!.output.warnings;
    expect(warnings).toEqual([
      expect.objectContaining({ beatId: 'beat2', code: 'unknown_asset', soft: true }),
    ]);
  });
});

/**
 * P1C.7's acceptance: each fixture topic's recorded chain replayed (Researcher, Director, then
 * the Generator per beat, repairs included), on spec v1 timed with the committed fixture as the
 * recording was made, gives a clean video: no call beyond the recording, no post-pass retry,
 * nothing left for gate 3.
 */
describe('generate job (both fixture topics, recorded Generator answers)', () => {
  function recordedRegistry(topic: FixtureTopicId): {
    reg: JobRegistry;
    recordedCalls: number;
  } {
    const generator = loadDryRunFixtures(fixtureResponsesDir('generator', topic)).generator!;
    const llm = createLlmClient({
      db: t.db,
      dataDir: t.dataDir,
      llm: settings.llm,
      transport: dryRunTransport({
        researcher: recordedInOrder(fixtureResponsesDir('researcher', topic), 'researcher'),
        director: recordedInOrder(fixtureResponsesDir('director', topic), 'director'),
        generator,
      }),
      now: () => NOW,
    });
    const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings };
    const reg = createJobRegistry([
      ingestJobHandler(deps),
      researchJobHandler(deps),
      directJobHandler(deps),
      generateJobHandler(deps),
    ]);
    return { reg, recordedCalls: Object.values(generator).flat().length };
  }

  async function timedRun(topic: FixtureTopicId, reg: JobRegistry) {
    const { topic: details, sourceFiles, seriesTag } = fixtureTopic(topic);
    const { runId } = seedRunWithUploads(t.db, t.dataDir, details, sourceFiles, { seriesTag });
    await runNext(reg);
    for (const type of [RESEARCH_JOB_TYPE, DIRECT_JOB_TYPE]) {
      enqueueJob(t.db, { type, runId });
      await runNext(reg);
    }
    const scripted = validateVideoSpec(fixtureScriptedSpec(topic)).spec!;
    const pauses = settings.timing;
    const spec = withFixtureTiming(scripted, loadTimingFixture(topic), pauses);
    const saved = saveSpecVersion(t.db, t.dataDir, { runId, spec, createdBy: 'agent' });
    return { runId, specVersionId: saved.version.id };
  }

  it.each(FIXTURE_TOPIC_IDS)('%s replays clean', async (topic) => {
    const { reg, recordedCalls } = recordedRegistry(topic);
    const { runId, specVersionId } = await timedRun(topic, reg);
    const job = await generate(reg, runId, { specVersionId });
    expect(job.status, job.error ?? '').toBe('done');

    const generation = latestGeneration(t.db, t.dataDir, runId)!;
    expect(generation.output.warnings).toEqual([]);
    expect(generation.output.beats.map((b) => [b.beatId, b.outcome, b.retried])).toEqual(
      latestSpec(runId).story.beats.map((b) => [b.id, 'generated', false]),
    );
    expect(generatorCalls(runId)).toHaveLength(recordedCalls);

    const spec = latestSpec(runId);
    const checked = withRegistryChecks(validateRenderableVideoSpec(spec), spec, DEFAULT_REGISTRIES);
    expect(checked.errors).toEqual([]);
    expect(specLayoutWarnings(checked.spec!, getTheme())).toEqual([]);
    expect(readMissingAssets(t.dataDir, runId)).toEqual([]);
  });
});
