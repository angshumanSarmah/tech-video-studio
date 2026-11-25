import { readFileSync } from 'node:fs';
import { hudTextWarnings } from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  CuratorReportSchema,
  DirectorPlanSchema,
  ScriptwriterInputSchema,
  type DirectorPlan,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataJson, resolveDataPath } from '#core/data-files.ts';
import { listRunJobs, type Job } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls, runCostUsd } from '#core/db/repositories/llm-calls.ts';
import { latestDoneStep } from '#core/db/repositories/run-steps.ts';
import { getRun, listPartRuns, type Run } from '#core/db/repositories/runs.ts';
import { getSeries, seriesChannelHandle } from '#core/db/repositories/series.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { videoCostUsd } from '#core/services/budget.ts';
import { latestDirection } from '#core/services/direction.ts';
import { answer, reviewOf } from '#worker/agents/curator/testing.ts';
import type { DryRunResponse } from '#worker/llm/dry-run.ts';
import { decided, expectError, Harness } from './harness.ts';

/**
 * P1C.9 step 8's acceptance, through the API and the dry-run worker: a hand-written two-part
 * plan of the tokenizer (part 1: b1-b4, ending on a cliffhanger; part 2: a recap, then b5-b7)
 * saved as a gate-2 edit becomes two part runs that each reach their draft. Part 2's Scriptwriter
 * reads part 1's narration and its recap quotes it; each part's spec knows its part (PART n/N,
 * HUD checks clean, no ending or recap findings); and a cost cap between one part's spend and
 * the parts' combined spend pauses part 2 until it is raised on the parent.
 */

const TOPIC = 'tokenizer';
/** Gate 2 waits (the plan is edited there); each part stops at its draft. */
const AUTO = { research: true, beat_sheet: false, scenes: true, draft: false };
/** Part 2 runs about 40 s: below the default 45 s minimum. */
const VIDEO = { lengthMinSec: 30 };

const CLIFFHANGER = ' Next: why does shouted Paris split apart?';
const RECAP_QUOTE = 'early merges join common pairs';
const RECAP =
  'Last time: early merges join common pairs, late merges build whole words. ' +
  'Now see where token counts bite.';

let h: Harness;

beforeEach(() => {
  h = new Harness(TOPIC);
});

afterEach(() => h.cleanup());

/** The recorded plan as two parts: no planted question across them, a cliffhanger and a recap. */
function twoPartPlan(recorded: DirectorPlan): DirectorPlan {
  const plan = structuredClone(recorded);
  delete plan.meta.targetLengthSec;
  delete plan.story.plantedQuestion;
  const beat = (id: string) => plan.story.beats.find((b) => b.id === id)!;
  delete beat('b1').device;
  Object.assign(beat('b4'), { device: 'cliffhanger_ending', targetSec: 12 });
  // Part 2's hook: the story's puzzle, asked as a question.
  beat('b5').intent = 'Why does a capitalised word split into more pieces than a plain one?';
  plan.story.beats.splice(4, 0, {
    id: 'recap',
    chapterId: 'where_counts_bite',
    intent: 'Recap the first part: merges are learned over bytes and replayed in order',
    device: 'recap_opening',
    targetSec: 7,
    factIds: [],
    newTerms: [],
    continuesPrevious: false,
    suggestedPatternIds: [],
    exampleNumbers: false,
    layoutMode: 'centered_focus',
  });
  const used = new Set(plan.story.beats.flatMap((b) => (b.device ? [b.device] : [])));
  plan.story.devices = [...used];
  plan.parts = [
    {
      part: 1,
      title: 'How merges are learned',
      mainIdea: 'A tokenizer learns merges over bytes and replays them in order.',
      beatIds: ['b1', 'b2', 'b3', 'b4'],
      targetLengthSec: 44,
    },
    {
      part: 2,
      title: 'Where token counts bite',
      mainIdea: 'Pre-tokenization decides the splits, and budgets must count real tokens.',
      beatIds: ['recap', 'b5', 'b6', 'b7'],
      targetLengthSec: 40,
    },
  ];
  return DirectorPlanSchema.parse(plan);
}

/** The recorded script, split: part 1 ends on its cliffhanger line, part 2 opens with the recap. */
function partScripts(): [DryRunResponse, DryRunResponse] {
  const recorded = JSON.parse(h.recording('scriptwriter').at(-1)!.content!) as {
    script: { beatId: string; narration: string }[];
  };
  const of = (ids: string[]) => recorded.script.filter((b) => ids.includes(b.beatId));
  const one = of(['b1', 'b2', 'b3', 'b4']).map((b) =>
    b.beatId === 'b4' ? { ...b, narration: b.narration + CLIFFHANGER } : b,
  );
  const recap = { beatId: 'recap', narration: RECAP, tags: ['whole words last'], statCards: [] };
  return [answer({ script: one }), answer({ script: [recap, ...of(['b5', 'b6', 'b7'])] })];
}

/** The recap's board: the merges part 1 explained, entering on their words. */
const RECAP_BOARD = answer({
  elements: [
    {
      id: 'merge-card',
      primitive: 'node_card',
      zone: 'center',
      props: { title: 'MERGES', subtitle: 'common pairs first', semantic: 'focus' },
    },
    {
      id: 'whole-words',
      primitive: 'tag',
      zone: 'aside',
      props: { text: 'whole words last', semantic: 'concept' },
    },
  ],
  patterns: [],
  events: [
    { at: { type: 'word', index: 3 }, action: 'enter', targets: ['merge-card'] },
    { at: { type: 'word', index: 10 }, action: 'enter', targets: ['whole-words'] },
  ],
  focus: ['merge-card'],
  transitionIn: 'fade',
});

/** The parent at gate 2 with the two-part plan saved as the user's edit, then approved. */
async function splitIntoParts(
  autoApprove: typeof AUTO = AUTO,
): Promise<{ parent: number; parts: [Run, Run] }> {
  const parent = h.start({ autoApprove, video: VIDEO });
  await h.drain();
  const recorded = latestDirection(h.t.db, h.t.dataDir, parent)!;
  const edit = await decided(
    await h.post(parent, 'beat_sheet', {
      action: 'edit',
      subjectId: recorded.step.id,
      content: twoPartPlan(recorded.plan),
    }),
  );
  await decided(
    await h.post(parent, 'beat_sheet', { action: 'approve', subjectId: edit.saved!.id }),
  );
  expect(getRun(h.t.db, parent)).toMatchObject({ status: 'running', pipelineStep: 'children' });
  h.drop('scriptwriter');
  const parts = listPartRuns(h.t.db, parent) as [Run, Run];
  return { parent, parts };
}

/** The job the worker claims next (`claimNextJob`'s order), skipping paused runs. */
function nextJob(runIds: readonly number[]): Job | undefined {
  return runIds
    .filter((id) => getRun(h.t.db, id)!.status !== 'paused')
    .flatMap((id) => listRunJobs(h.t.db, id))
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime() || a.id - b.id)[0];
}

/**
 * Runs the parts one job at a time; before each `curate`, a quiet review of the very spec it
 * pins (`curator`: the answers to give it). `before` may stop the loop before a job runs.
 */
async function runParts(
  runIds: readonly number[],
  curator: (spec: RenderableVideoSpec) => DryRunResponse[] = (spec) => reviewOf(spec),
  before: (job: Job) => boolean = () => true,
): Promise<Job | undefined> {
  for (;;) {
    const job = nextJob(runIds);
    if (!job || !before(job)) return job;
    const specVersionId = (job.payload as { specVersionId?: number }).specVersionId;
    const review = job.type === 'curate' ? curator(h.spec(specVersionId!)) : [];
    await h.drain({ curator: review }, 1);
  }
}

function latestSpec(runId: number): RenderableVideoSpec {
  return readDataJson(
    h.t.dataDir,
    getLatestSpecVersion(h.t.db, runId)!.jsonPath,
  ) as RenderableVideoSpec;
}

function curationCodes(runId: number): string[] {
  const step = latestDoneStep(h.t.db, runId, 'curate')!;
  const report = CuratorReportSchema.parse(readDataJson(h.t.dataDir, step.outputPath!));
  return report.codeIssues.map((i) => i.code);
}

describe('parts end to end', () => {
  it('a two-part plan gives two part runs that reach their drafts, each a part of the video', async () => {
    const { parent, parts } = await splitIntoParts();
    const [one, two] = parts;
    const [scriptOne, scriptTwo] = partScripts();
    await h.drain({ scriptwriter: [scriptOne, scriptTwo], generator: { recap: [RECAP_BOARD] } }, 0);
    await runParts([one.id, two.id]);

    for (const part of [one, two]) {
      expect(getRun(h.t.db, part.id)).toMatchObject({
        status: 'awaiting_review',
        pipelineStep: 'gate_draft',
      });
      expect(h.jobs(part.id)).toContain('render_draft');
    }
    expect(getRun(h.t.db, parent)).toMatchObject({ status: 'running', pipelineStep: 'children' });

    // Each spec knows its part: part 1 ends on its cliffhanger, only part 2 closes the topic.
    const [first, second] = [latestSpec(one.id), latestSpec(two.id)];
    expect(first.meta.part).toEqual({ index: 1, count: 2 });
    expect(second.meta.part).toEqual({ index: 2, count: 2 });
    // No spec card or call to action before the last part: no ending card.
    expect(first.story.ending).toEqual({ kind: 'cliffhanger_ending', seriesNumber: 1 });
    expect(second.story.ending).toMatchObject({ kind: 'spec_card_ending' });
    expect(second.story.ending.specCard?.lines).toHaveLength(3);
    expect(second.story.ending.seriesNumber).toBe(first.story.ending.seriesNumber! + 1);

    // The checks know the part: no wrong ending, no missing recap or cliffhanger.
    const partCodes = ['ending_kind', 'cliffhanger_missing', 'recap_missing'];
    for (const part of [one, two]) {
      expect(curationCodes(part.id).filter((c) => partCodes.includes(c))).toEqual([]);
    }

    // PART n/N in the title block: its HUD text checks are clean for both parts.
    const series = getSeries(h.t.db, one.seriesId)!;
    const hud = {
      seriesLabel: series.label,
      channelHandle: seriesChannelHandle(h.t.db, series.id),
    };
    for (const spec of [first, second]) expect(hudTextWarnings(spec, getTheme(), hud)).toEqual([]);

    // Part 2's Scriptwriter read part 1's narration; its recap quotes it.
    const input = ScriptwriterInputSchema.parse(
      readDataJson(h.t.dataDir, latestDoneStep(h.t.db, two.id, 'script')!.inputPath!),
    );
    expect(input.part).toMatchObject({ index: 2, count: 2 });
    const partOneNarration = first.script.map((b) => b.narration).join(' ');
    const prompt = scriptwriterPrompt(two.id);
    for (const beat of first.script) expect(prompt).toContain(JSON.stringify(beat.narration));
    expect(prompt).toContain('"nextPart": null');
    expect(scriptwriterPrompt(one.id)).toContain('"previousPart": null');
    const recap = second.script.find((b) => b.beatId === 'recap')!.narration;
    expect(recap.toLowerCase()).toContain(RECAP_QUOTE);
    expect(partOneNarration.toLowerCase()).toContain(RECAP_QUOTE);
  });
});

describe('the recap and part 1’s approved narration', () => {
  it('part 2 writes its script once part 1’s scenes are approved; a G4 edit of part 1 marks the recap stale until it is regenerated', async () => {
    const { parts } = await splitIntoParts({ ...AUTO, scenes: false });
    const [one, two] = parts;
    const [scriptOne, scriptTwo] = partScripts();
    await h.drain({ scriptwriter: [scriptOne, scriptTwo], generator: { recap: [RECAP_BOARD] } }, 0);
    await runParts([one.id, two.id]);

    // Part 1 waits at its scenes gate; part 2 has not started its script.
    expect(getRun(h.t.db, one.id)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_scenes',
    });
    expect(getRun(h.t.db, two.id)!.pipelineStep).toBe('script');
    expect(h.jobs(two.id)).toEqual([]);
    const scenesOne = await h.gate(one.id, 'scenes');
    await decided(
      await h.post(one.id, 'scenes', { action: 'approve', subjectId: scenesOne.subject!.id }),
    );
    expect(h.jobs(two.id)).toEqual(['script']);
    await runParts([one.id, two.id]);
    const scenesTwo = await h.gate(two.id, 'scenes');
    await decided(
      await h.post(two.id, 'scenes', { action: 'approve', subjectId: scenesTwo.subject!.id }),
    );
    await runParts([one.id, two.id]);
    for (const part of [one, two]) {
      expect(getRun(h.t.db, part.id)).toMatchObject({ pipelineStep: 'gate_draft' });
    }
    // The recap was written from the version part 1's scenes gate approved.
    const input = ScriptwriterInputSchema.parse(
      readDataJson(h.t.dataDir, latestDoneStep(h.t.db, two.id, 'script')!.inputPath!),
    );
    expect(input.part?.previousSpecVersionId).toBe(scenesOne.subject!.id);
    expect(staleBadges(await h.gate(two.id, 'draft'))).toEqual([]);

    // A G4 edit of part 1's narration: re-timed, curated, the scenes gate carried to it.
    const draftOne = await h.gate(one.id, 'draft');
    const edited = structuredClone(latestSpec(one.id));
    const b2 = edited.script.find((b) => b.beatId === 'b2')!;
    b2.narration = `${b2.narration} That is the whole trick.`;
    await decided(
      await h.post(one.id, 'draft', {
        action: 'edit',
        subjectId: draftOne.subject!.id,
        content: edited,
      }),
    );
    await runParts([one.id, two.id]);
    expect(getRun(h.t.db, one.id)).toMatchObject({ pipelineStep: 'gate_draft' });

    // Part 2's recap is stale: advisory, on the recap beat, with the fix.
    const stale = staleBadges(await h.gate(two.id, 'draft'));
    expect(stale).toEqual([
      {
        beatId: 'recap',
        source: 'code',
        code: 'recap_stale',
        severity: 'advisory',
        owner: 'scriptwriter',
        message:
          "Part 1's narration changed after this recap was written (b2): the recap may be " +
          'stale. Regenerate beat recap (narration) so it recaps part 1 as it is now.',
        needsPlanChange: false,
      },
    ]);
    expect((await h.gate(two.id, 'draft')).blocking).toEqual([]);

    // Regenerating the recap beat reads part 1 as it is now: the badge is gone.
    const draftTwo = await h.gate(two.id, 'draft');
    await decided(
      await h.post(two.id, 'draft', {
        action: 'regenerate',
        target: 'beat',
        beatId: 'recap',
        fields: ['narration'],
        feedback: 'Recap part 1 as it reads now.',
      }),
    );
    const recapEntry = latestSpec(two.id).script.find((b) => b.beatId === 'recap')!;
    const revised = { ...recapEntry, narration: `${RECAP} Ready?` };
    await h.drain({ scriptwriter: [answer({ script: [revised] })] }, 0);
    await runParts([one.id, two.id]);
    expect(getRun(h.t.db, two.id)).toMatchObject({ pipelineStep: 'gate_draft' });
    expect(latestSpec(two.id).script.find((b) => b.beatId === 'recap')!.narration).toBe(
      revised.narration,
    );
    expect(scriptwriterPrompts(two.id).at(-1)).toContain('That is the whole trick.');
    expect(draftTwo.subject!.id).not.toBe((await h.gate(two.id, 'draft')).subject!.id);
    expect(staleBadges(await h.gate(two.id, 'draft'))).toEqual([]);
  });
});

const staleBadges = (gate: { badges: { code: string }[] }) =>
  gate.badges.filter((b) => b.code === 'recap_stale');

describe('the cost cap per video', () => {
  it('a cap between one part’s spend and the parts’ combined spend pauses part 2; raising it on the parent resumes it', async () => {
    const { parent, parts } = await splitIntoParts();
    const [one, two] = parts;
    const [scriptOne, scriptTwo] = partScripts();
    await h.drain({ scriptwriter: [scriptOne, scriptTwo], generator: { recap: [RECAP_BOARD] } }, 0);
    // The reviews cost something here, so part 2's still lies ahead when the cap is set.
    const costed = (spec: RenderableVideoSpec) => reviewOf(spec).map(withUsage);

    // Part 1 has made its last call (its review); part 2's review is next.
    const next = await runParts(
      [one.id, two.id],
      costed,
      (job) => job.runId !== two.id || job.type !== 'curate',
    );
    expect(next).toMatchObject({ type: 'curate', runId: two.id });
    expect(latestDoneStep(h.t.db, one.id, 'curate')).toBeDefined();
    const beforePartTwo = runCostUsd(h.t.db, parent) + runCostUsd(h.t.db, one.id);
    const cap = videoCostUsd(h.t.db, parent);
    expect(cap).toBeGreaterThan(beforePartTwo);

    // Set on the parent while it waits for its parts; a part's own cap is refused.
    await expectError(await h.putSettings(two.id, { budget: { maxRunUsd: 5 } }), 400);
    const set = await h.putSettings(parent, { budget: { maxRunUsd: cap } });
    expect(set.status, await set.clone().text()).toBe(200);
    await runParts([one.id, two.id], costed);

    expect(getRun(h.t.db, two.id)).toMatchObject({ status: 'paused', pipelineStep: 'curate' });
    expect(listRunJobs(h.t.db, two.id).at(-1)).toMatchObject({
      type: 'curate',
      status: 'queued',
      attempts: 0,
    });
    expect(h.logs(two.id).at(-1)).toContain(`raise the cap on run ${parent}`);
    expect(getRun(h.t.db, one.id)).toMatchObject({ status: 'awaiting_review' });
    expect(getRun(h.t.db, parent)).toMatchObject({ status: 'running', pipelineStep: 'children' });
    expect(videoCostUsd(h.t.db, parent)).toBe(cap);

    const raised = await h.putSettings(parent, { budget: { maxRunUsd: 5 } });
    expect(raised.status, await raised.clone().text()).toBe(200);
    expect(getRun(h.t.db, two.id)!.status).toBe('running');
    expect(h.logs(two.id).at(-1)).toContain('Resumed');
    await runParts([one.id, two.id], costed);

    expect(getRun(h.t.db, two.id)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_draft',
    });
    // The cap sat between part 1's share and the whole video's spend.
    expect(videoCostUsd(h.t.db, parent)).toBeGreaterThan(cap);
  });
});

/** The user message of the run's first Scriptwriter call. */
function scriptwriterPrompt(runId: number): string {
  return scriptwriterPrompts(runId)[0]!;
}

/** The user message of each of the run's Scriptwriter calls, in order. */
function scriptwriterPrompts(runId: number): string[] {
  return listRunLlmCalls(h.t.db, runId)
    .filter((c) => c.role === 'scriptwriter')
    .map((call) => {
      const prompt = JSON.parse(
        readFileSync(resolveDataPath(h.t.dataDir, call.promptPath), 'utf8'),
      ) as { messages: { role: string; content: string }[] };
      return prompt.messages.find((m) => m.role === 'user')!.content;
    });
}

/** A dry-run answer billed like a recorded review call. */
function withUsage(response: DryRunResponse): DryRunResponse {
  return {
    ...response,
    usage: {
      prompt_tokens: 13291,
      completion_tokens: 2000,
      prompt_cache_hit_tokens: 13056,
      prompt_cache_miss_tokens: 235,
    },
  };
}
