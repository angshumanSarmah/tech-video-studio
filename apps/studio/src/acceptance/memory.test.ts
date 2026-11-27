import { CurateInputSchema, DirectorInputSchema, type UsageKind } from '@explainer-studio/shared';
import { usageOfSpec } from '@explainer-studio/renderer/catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson } from '#core/data-files.ts';
import { recordExport } from '#core/db/repositories/exports.ts';
import { getGate } from '#core/db/repositories/gates.ts';
import { latestDoneStep } from '#core/db/repositories/run-steps.ts';
import { createRun, getRun, setActiveRunStatus } from '#core/db/repositories/runs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { usageOfRuns } from '#core/db/repositories/usage-history.ts';
import { latestDirection } from '#core/services/direction.ts';
import { curateRound } from '#worker/agents/curator/testing.ts';
import { fixtureGeneratedSpec } from '#worker/agents/generator/testing.ts';
import { decided, Harness } from './harness.ts';

/**
 * P1C.10's acceptance (M1, usage and topic history), through the dry-run worker and the API:
 * two videos in a row, the second planned and curated with the first's usage; a topic close to
 * an exported one warned about when its run starts; at the beat sheet, the previous video's
 * hook a warning that does not stop auto-approve, and a recent video's structure blocking.
 */

const ALL_AUTO = { research: true, beat_sheet: true, scenes: true, draft: true };

let h: Harness;

beforeEach(() => {
  h = new Harness('tokenizer');
});

afterEach(() => h.cleanup());

const t = () => h.t;

/** The newest finished step's input of a stage, parsed. */
function stepInput<T>(runId: number, stage: 'direct' | 'curate', schema: { parse(v: unknown): T }) {
  const step = latestDoneStep(t().db, runId, stage);
  expect(step?.inputPath).toBeTruthy();
  return schema.parse(readDataJson(t().dataDir, step!.inputPath!));
}

const usageRows = (runId: number) =>
  usageOfRuns(t().db, [runId]).map(({ kind, value }) => ({ kind, value }));

/** An exported video of an earlier topic, with this usage (as `render_final` records it). */
function earlierVideo(title: string, usage: [UsageKind, string][], exportTitle = title): number {
  const run = createRun(t().db, {
    app: h.settings,
    topicId: createTopic(t().db, { title }).id,
    seriesId: listSeries(t().db)[0]!.id,
  });
  recordExport(t().db, {
    runId: run.id,
    mp4Path: `exports/${run.id}/v.mp4`,
    srtPath: `exports/${run.id}/v.srt`,
    durationMs: 60_000,
    title: exportTitle,
    usage: usage.map(([kind, value]) => ({ kind, value })),
  });
  setActiveRunStatus(t().db, run.id, 'done');
  return run.id;
}

/** The tokenizer's recorded video as exported (its boards' usage), with references it was shown. */
const TOKENIZER_TITLE = 'How an LLM tokenizer works';
const SHOWN = ['database-failover-split-brain', 'food-delivery-eta'];

function exportedTokenizer(): number {
  const spec = fixtureGeneratedSpec('tokenizer');
  const usage = usageOfSpec(spec).map(({ kind, value }) => [kind, value] as [UsageKind, string]);
  const shown = SHOWN.map((slug) => ['reference', slug] as [UsageKind, string]);
  return earlierVideo(TOKENIZER_TITLE, [...usage, ...shown], spec.meta.title);
}

/**
 * Each test drives at most one dry-run pipeline: the second video starts from the first one's
 * export as `render_final` records it (seeded), not from a second full run, so no test does the
 * work of two videos (two pipelines in one test outran the 5 s timeout under full-suite load).
 */
describe('usage history: one video after another', () => {
  it('records a video’s usage at its export: its boards, then the references its Director saw', async () => {
    const first = h.start({ autoApprove: ALL_AUTO });
    await h.drain(curateRound('tokenizer'));
    expect(getRun(t().db, first)!.status).toBe('done');
    const exported = getLatestSpecVersion(t().db, first)!;
    const shown = stepInput(first, 'direct', DirectorInputSchema).references?.picks ?? [];
    expect(shown.length).toBeGreaterThan(0);
    expect(usageRows(first)).toEqual([
      ...usageOfSpec(h.spec(exported.id)),
      ...shown.map((p) => ({ kind: 'reference', value: p.slug })),
    ]);
    expect(usageRows(first)).toContainEqual({ kind: 'hook', value: 'puzzle/planted_question' });
  });

  it('plans and curates the next video with the earlier one’s usage', async () => {
    exportedTokenizer();
    h.useTopic('rate-limiter');
    const second = h.start({ autoApprove: ALL_AUTO });
    h.drop('researcher');
    await h.drain({ ...curateRound('rate-limiter'), researcher: h.researcherFor(second) });
    expect(getRun(t().db, second)!.status, h.logs(second).join('\n')).toBe('done');

    const tokenizer = fixtureGeneratedSpec('tokenizer');
    const { memory } = stepInput(second, 'direct', DirectorInputSchema);
    expect(memory.recent.videos).toBe(1);
    expect(memory.recent.combos).toContain('planted_question/grid');
    expect(memory.recent.combos).toContain('versus_split/versus_split');
    expect(memory.recent.structures).toEqual([
      { title: tokenizer.meta.title, hooks: ['puzzle/planted_question'], sequences: [] },
    ]);
    expect(memory.pastTopics.map((p) => p.title)).toEqual([TOKENIZER_TITLE]);
    // The earlier video's references count against being shown again (rotation, P1C.11).
    expect(memory.recent.referencesShown).toEqual(Object.fromEntries(SHOWN.map((s) => [s, 1])));
    // The two recorded plans share one device/layout combo, on one beat each: within the reuse
    // allowed, so the beat sheet approved itself with nothing to report.
    const reused = latestDirection(t().db, t().dataDir, second)!.plan.story.beats.filter(
      (b) =>
        b.device && b.layoutMode && memory.recent.combos.includes(`${b.device}/${b.layoutMode}`),
    );
    expect(reused.map((b) => b.id)).toEqual(['beat3']);
    expect(getGate(t().db, second, 'beat_sheet')).toMatchObject({
      status: 'approved',
      decidedBy: 'auto',
    });
    expect((await h.gate(second, 'beat_sheet')).warnings).toEqual([]);

    const curate = stepInput(second, 'curate', CurateInputSchema);
    expect(curate.recent).toEqual({
      videos: 1,
      combos: memory.recent.combos,
      patterns: [],
      structures: memory.recent.structures,
    });
    // Each video records its own usage at its export.
    expect(usageRows(second)).toContainEqual({ kind: 'hook', value: 'problem/seen_this_bug' });
  });

  it('warns when a run starts on a topic already exported', () => {
    const first = exportedTokenizer();
    const run = h.start();
    expect(h.logs(run)).toContainEqual(
      expect.stringMatching(
        new RegExp(`^Close to an earlier topic: "${TOKENIZER_TITLE}" \\(run ${first}, exported `),
      ),
    );
  });
});

describe('the beat sheet against the history', () => {
  it('warns about the previous video’s hook and a similar topic without blocking auto-approve', async () => {
    earlierVideo('LLM tokenizers', [['hook', 'puzzle/planted_question']]);
    const runId = h.start({ autoApprove: { research: true, beat_sheet: true } });
    await h.drain({}, 3); // ingest, research, direct

    expect(getGate(t().db, runId, 'beat_sheet')).toMatchObject({
      status: 'approved',
      decidedBy: 'auto',
    });
    const gate = await h.gate(runId, 'beat_sheet');
    expect(gate.blocking).toEqual([]);
    expect(gate.warnings.map((w) => [w.code, w.path])).toEqual([
      ['hook_repeated', '$.story.beats[0]'],
      ['topic_similar', '$.meta.title'],
    ]);
    expect(gate.warnings[1]?.message).toMatch(/^Close to an earlier topic: "LLM tokenizers"/);
  });

  it('blocks a plan with a recent video’s structure: the same hook and main patterns', async () => {
    earlierVideo('<an earlier topic>', [
      ['hook', 'puzzle/planted_question'],
      ['pattern_sequence', 'versus_split>flood_then_funnel'],
    ]);
    const runId = await h.runUntilWaiting({ research: true });
    const before = latestDirection(t().db, t().dataDir, runId)!;
    expect((await h.gate(runId, 'beat_sheet')).blocking).toEqual([]);

    // The recorded plan suggests only versus_split; a second pattern makes the same sequence.
    const plan = structuredClone(before.plan);
    plan.story.beats[2]!.suggestedPatternIds = ['flood_then_funnel'];
    const res = await decided(
      await h.post(runId, 'beat_sheet', {
        action: 'edit',
        subjectId: before.step.id,
        content: plan,
      }),
    );
    expect(res.issues.map((i) => i.code)).toContain('structure_repeated');
    expect(res.run).toEqual({ status: 'awaiting_review', step: 'gate_beat_sheet' });
    const gate = await h.gate(runId, 'beat_sheet');
    expect(gate.blocking).toContainEqual(
      expect.stringMatching(/^structure_repeated at \$\.story\.beats\[0\]: .*"<an earlier topic>"/),
    );
    // The structure is the finding; the hook alone is not reported again.
    expect(gate.warnings.map((w) => w.code)).not.toContain('hook_repeated');
  });
});
