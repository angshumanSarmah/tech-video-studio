import { join } from 'node:path';
import {
  narrationSentences,
  SettingsSchema,
  type Claim,
  type CuratorIssue,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enqueueJob } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { latestCuration } from '#core/services/curation.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { editNarration } from '../agents/curator/fixtures.ts';
import { reviewBeatTexts } from '../agents/curator/input.ts';
import { fixtureResponsesDir, fixtureRunSettings, fixtureTopic } from '../agents/fixture-topics.ts';
import {
  fixtureGeneratedSpec,
  recordedNotes,
  recordedScript,
} from '../agents/generator/testing.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../agents/prompts/templates.ts';
import { seedRunWithUploads } from '../agents/researcher/testing.ts';
import { createLlmClient } from '../llm/client.ts';
import { dryRunTransport, recordedInOrder, type DryRunResponse } from '../llm/dry-run.ts';
import { uniformTts } from '../repair/testing.ts';
import { runNextJob } from '../runner.ts';
import { CURATE_JOB_TYPE, curateJobHandler } from './curate.ts';
import { DIRECT_JOB_TYPE, directJobHandler } from './direct.ts';
import { ingestJobHandler } from './ingest.ts';
import { createJobRegistry } from './registry.ts';
import { RESEARCH_JOB_TYPE, researchJobHandler } from './research.ts';

/**
 * The curate job's repair loop (P1C.8 step 9), with dry-run answers for the review and the
 * Scriptwriter and a TTS that reads every word in 0.3 s (so no beat runs over its plan). Specs
 * start untimed, like a gate edit before TTS; the first repair times them.
 */

const prompts = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const settings = SettingsSchema.parse({});
const researcher = recordedInOrder(fixtureResponsesDir('researcher', 'rate-limiter'), 'researcher');
const director = recordedInOrder(fixtureResponsesDir('director', 'rate-limiter'), 'director');

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

const answer = (value: unknown): DryRunResponse => ({
  content: JSON.stringify(value),
  servedModel: 'recorded',
  finishReason: 'stop',
  usage: null,
});

/** A complete claims audit that supports nothing and flags nothing (every entry no_claim). */
function quietClaims(spec: RenderableVideoSpec): DryRunResponse {
  const claims: Claim[] = reviewBeatTexts(spec).flatMap((beat) => [
    ...narrationSentences(beat.narration).map((text) => ({
      beatId: beat.beatId,
      source: 'narration' as const,
      text,
      verdict: 'no_claim' as const,
      ids: [],
    })),
    ...(beat.drawnValues ?? []).map((v) => ({
      beatId: beat.beatId,
      source: 'value' as const,
      elementId: v.elementId,
      text: v.value,
      verdict: 'no_claim' as const,
      ids: [],
    })),
  ]);
  return answer({ claims, issues: [] });
}

const story = (issues: CuratorIssue[], previous?: { id: string; status: string }[]) =>
  answer({ issues, ...(previous ? { previous } : {}) });

/** A review pair (claims, story) for one version of the spec. */
const reviewOf = (
  spec: RenderableVideoSpec,
  issues: CuratorIssue[],
  previous?: { id: string; status: string }[],
) => [quietClaims(spec), story(issues, previous)];

/** The recorded rate-limiter spec without its timing, with `edit` applied. */
function untimed(edit: (spec: RenderableVideoSpec) => void = () => undefined): RenderableVideoSpec {
  const spec = structuredClone(fixtureGeneratedSpec('rate-limiter'));
  delete spec.timing;
  edit(spec);
  return spec;
}

/** The Scriptwriter's recorded beat with this narration, as a one-beat answer. */
function beatWith(beatId: string, narration: string): DryRunResponse {
  const beat = recordedScript('rate-limiter').script.find((b) => b.beatId === beatId)!;
  return answer({ script: [{ ...beat, narration }] });
}

async function curate(
  spec: RenderableVideoSpec,
  curator: DryRunResponse[],
  scriptwriter: DryRunResponse[] = [],
) {
  const llm = createLlmClient({
    db: t.db,
    dataDir: t.dataDir,
    llm: settings.llm,
    transport: dryRunTransport({ researcher, director, curator, scriptwriter }),
  });
  const tts = uniformTts(join(t.dataDir, 'fake-tts')).provider;
  const deps = { db: t.db, dataDir: t.dataDir, llm, prompts, settings, tts };
  const reg = createJobRegistry([
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    curateJobHandler(deps),
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
  const saved = saveSpecVersion(t.db, t.dataDir, { runId, spec, createdBy: 'user' });
  enqueueJob(t.db, { type: CURATE_JOB_TYPE, runId, payload: { specVersionId: saved.version.id } });
  await next();
  const curation = latestCuration(t.db, t.dataDir, runId);
  if (!curation) throw new Error('curate did not finish');
  const calls = (role: string) =>
    listRunLlmCalls(t.db, runId).filter((c) => c.role === role).length;
  return { report: curation.report, calls };
}

/** A blocking narration issue on a beat, quoting it. */
function narrationIssue(
  beatId: string,
  category: CuratorIssue['category'],
  quote: string,
): CuratorIssue {
  return {
    beatId,
    category,
    severity: 'blocking',
    owner: 'scriptwriter',
    fields: ['narration'],
    evidence: [{ kind: 'narration', quote }],
    problem: '<example-problem>',
    fix: '<example-fix>',
  };
}

const RETOLD = 'Thirty-one percent of checkouts failed.';

describe('curate: the repair loop', () => {
  it("repairs beat7's retold hook number in one round and comes out clean", async () => {
    const seeded = untimed((s) => editNarration(s, 'beat7', 'Checkouts started failing.', RETOLD));
    const fixed = seeded.script[6]!.narration.replace(RETOLD, 'Checkouts failed.');
    const repaired = untimed((s) =>
      editNarration(s, 'beat7', 'Checkouts started failing.', 'Checkouts failed.'),
    );
    const { report, calls } = await curate(
      seeded,
      [...reviewOf(seeded, []), ...reviewOf(repaired, [], [])],
      [beatWith('beat7', fixed)],
    );
    expect(report.rounds).toHaveLength(1);
    expect(report.rounds[0]?.blockingBefore).toEqual(['beat7:hook_number_repeated']);
    expect(report.rounds[0]?.blockingAfter).toEqual([]);
    expect(report.rounds[0]?.repair.beats).toEqual([
      expect.objectContaining({ beatId: 'beat7', script: 'revised', board: 'remapped' }),
    ]);
    expect(report.stop).toBe('clean');
    expect(report.blocking).toBe(false);
    expect(report.final.version).toBeGreaterThan(report.version);
    expect(calls('generator')).toBe(0);
  });

  it("sends a Director's issue to the gate unrepaired, marked as needing a plan change", async () => {
    const spec = untimed();
    const tradeOff = recordedNotes('rate-limiter').tradeOffs[0]!.costs;
    const missing: CuratorIssue = {
      beatId: 'beat8',
      category: 'missing_trade_off',
      severity: 'advisory',
      owner: 'director',
      fields: ['plan'],
      evidence: [{ kind: 'note', quote: tradeOff }],
      problem: '<example-problem>',
      fix: '<example-fix>',
    };
    const { report, calls } = await curate(spec, reviewOf(spec, [missing]));
    expect(report.rounds).toEqual([]);
    expect(calls('scriptwriter') + calls('generator')).toBe(0);
    expect(report.badges).toContainEqual(
      expect.objectContaining({
        beatId: 'beat8',
        source: 'review',
        code: 'missing_trade_off',
        owner: 'director',
        needsPlanChange: true,
      }),
    );
    expect(report.final.version).toBe(report.version);
  });

  it('stops after two rounds when each repair trades one blocking issue for another', async () => {
    const n0 = untimed();
    const n1 = untimed((s) => editNarration(s, 'beat2', 'a pile of passes', 'a stack of passes'));
    const n2 = untimed((s) => editNarration(s, 'beat2', 'a pile of passes', 'a pile of tickets'));
    const { report, calls } = await curate(
      n0,
      [
        ...reviewOf(n0, [narrationIssue('beat2', 'wrong_simplification', 'a pile of passes')]),
        ...reviewOf(
          n1,
          [narrationIssue('beat2', 'above_level', 'a stack of passes')],
          [{ id: 'issue-1', status: 'fixed' }],
        ),
        ...reviewOf(
          n2,
          [narrationIssue('beat2', 'wrong_simplification', 'a pile of tickets')],
          [{ id: 'issue-1', status: 'fixed' }],
        ),
      ],
      [beatWith('beat2', n1.script[1]!.narration), beatWith('beat2', n2.script[1]!.narration)],
    );
    expect(report.rounds.map((r) => [r.blockingBefore, r.blockingAfter])).toEqual([
      [['beat2:wrong_simplification'], ['beat2:above_level']],
      [['beat2:above_level'], ['beat2:wrong_simplification']],
    ]);
    expect(report.stop).toBe('max_rounds');
    expect(report.blocking).toBe(true);
    expect(calls('scriptwriter')).toBe(2);
  });

  it('puts a beat back when its repair leaves it worse, then stops for no progress', async () => {
    const n0 = untimed();
    const n1 = untimed((s) => editNarration(s, 'beat2', 'a pile of passes', 'a stack of passes'));
    const { report } = await curate(
      n0,
      [
        ...reviewOf(n0, [narrationIssue('beat2', 'wrong_simplification', 'a pile of passes')]),
        ...reviewOf(
          n1,
          [
            narrationIssue('beat2', 'above_level', 'a stack of passes'),
            narrationIssue('beat2', 'wrong_simplification', 'a stack of passes'),
          ],
          [{ id: 'issue-1', status: 'not_fixed' }],
        ),
      ],
      [beatWith('beat2', n1.script[1]!.narration)],
    );
    expect(report.rounds).toHaveLength(1);
    // beat2 starts its own board, so it is put back alone.
    expect(report.rounds[0]?.restored).toEqual(['beat2']);
    expect(report.rounds[0]?.blockingAfter).toEqual(['beat2:wrong_simplification']);
    expect(report.stop).toBe('no_progress');
    expect(report.review?.issues.map((i) => i.evidence)).toEqual([
      [{ kind: 'narration', quote: 'a pile of passes' }],
    ]);
  });
});
