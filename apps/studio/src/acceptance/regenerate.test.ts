import { appendFileSync, readFileSync } from 'node:fs';
import { outcomeLine, type GateId, type RenderableVideoSpec } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPath } from '#core/data-files.ts';
import { gateEvents } from '#core/db/repositories/events.ts';
import { getGate } from '#core/db/repositories/gates.ts';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRun, listRunSources } from '#core/db/repositories/runs.ts';
import { listTopicSources } from '#core/db/repositories/sources.ts';
import { getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { latestCuration } from '#core/services/curation.ts';
import { latestDirection } from '#core/services/direction.ts';
import { readGate } from '#core/services/gates.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { startRun } from '#core/services/runs.ts';
import { fixtureRunSettings } from '#worker/agents/fixture-topics.ts';
import { answer, reviewOf } from '#worker/agents/curator/testing.ts';
import { fixtureGeneratedSpec } from '#worker/agents/generator/testing.ts';
import { decided, expectError, Harness } from './harness.ts';

/**
 * P1C.9 step 5's acceptance: every regenerate path through the API and the dry-run worker. The
 * reviewer's feedback reaches the rerun's user message as a FEEDBACK section; beats a one-beat
 * regenerate does not name stay byte-identical; at the draft gate only the changed clip renders
 * again, and the scenes gate keeps its approval, marked as decided at the draft gate.
 */

const TOPIC = 'tokenizer';
const FEEDBACK = '<example-feedback>';
const SPEC = fixtureGeneratedSpec(TOPIC);
const QUIET = reviewOf(SPEC);
/** A single-beat board with no new terms: a one-beat regenerate touches nothing else. */
const BEAT = 'b6';

let h: Harness;

beforeEach(() => {
  h = new Harness(TOPIC);
});

afterEach(() => h.cleanup());

/** Every prompt the role was sent in this run, as text. */
function prompts(runId: number, role: string): string[] {
  return listRunLlmCalls(h.t.db, runId)
    .filter((c) => c.role === role)
    .map((c) => readFileSync(resolveDataPath(h.t.dataDir, c.promptPath), 'utf8'));
}

const hasFeedback = (prompt: string) => prompt.includes('## FEEDBACK') && prompt.includes(FEEDBACK);

const lastJob = (runId: number) => listRunJobs(h.t.db, runId).at(-1)!;

/** The run, waiting at `gate` again. */
function expectWaitingAt(runId: number, step: string): void {
  expect(getRun(h.t.db, runId)).toMatchObject({ status: 'awaiting_review', pipelineStep: step });
}

describe('regenerate at the research gate', () => {
  it('runs the Researcher again with the feedback', async () => {
    const runId = await h.runUntilWaiting({});
    const before = latestResearch(h.t.db, h.t.dataDir, runId)!.step.id;
    const res = await decided(
      await h.post(runId, 'research', {
        action: 'regenerate',
        target: 'researcher',
        feedback: FEEDBACK,
      }),
    );
    expect(res.run).toEqual({ status: 'running', step: 'research' });
    expect(lastJob(runId)).toMatchObject({ type: 'research', payload: { feedback: FEEDBACK } });

    await h.drain({ researcher: h.recording('researcher') }, 1);
    expectWaitingAt(runId, 'gate_research');
    const research = latestResearch(h.t.db, h.t.dataDir, runId)!;
    expect(research.step.id).not.toBe(before);
    expect(research.input.feedback).toBe(FEEDBACK);
    expect(prompts(runId, 'researcher').map(hasFeedback)).toEqual([false, true]);
    expect((await h.gate(runId, 'research')).subject).toEqual({
      kind: 'step',
      id: research.step.id,
    });
  });

  it('a re-fetch pins the new text for the run that asked; a new run on the topic uses it too', async () => {
    const first = await h.runUntilWaiting({});
    const { topicId, seriesId } = getRun(h.t.db, first)!;
    const second = startRun(h.t.db, {
      topicId,
      seriesId,
      settings: fixtureRunSettings({}),
      app: h.settings,
    }).run.id;
    await h.drain({ researcher: h.recording('researcher') });
    const pin = (runId: number, sourceId: number) =>
      listRunSources(h.t.db, runId).find((s) => s.sourceId === sourceId)?.contentHash;
    const source = listTopicSources(h.t.db, topicId)[0]!;
    const before = pin(first, source.id);
    expect(pin(second, source.id)).toBe(before);

    // The uploaded file changed; the second run fetches it again.
    appendFileSync(
      resolveDataPath(h.t.dataDir, source.filePath!),
      '\n\nAn added paragraph, long enough to count as new text in the normalized source.\n',
    );
    await decided(
      await h.post(second, 'research', {
        action: 'regenerate',
        target: 'source',
        sourceId: source.id,
      }),
    );
    await h.drain({ researcher: h.recording('researcher') });
    const after = pin(second, source.id);
    expect(after).not.toBe(before);
    // Limited to the run that asked: the first keeps the text it used.
    expect(pin(first, source.id)).toBe(before);

    // A new run on the topic starts from the latest fetched version.
    const third = startRun(h.t.db, {
      topicId,
      seriesId,
      settings: fixtureRunSettings({}),
      app: h.settings,
    }).run.id;
    await h.drain({}, 1);
    expect(pin(third, source.id)).toBe(after);
  });

  it('fetches one source again, then runs the Researcher', async () => {
    const runId = await h.runUntilWaiting({});
    const run = getRun(h.t.db, runId)!;
    const [source] = listTopicSources(h.t.db, run.topicId);
    await expectError(
      await h.post(runId, 'research', { action: 'regenerate', target: 'source', sourceId: 999 }),
      400,
    );
    await decided(
      await h.post(runId, 'research', {
        action: 'regenerate',
        target: 'source',
        sourceId: source!.id,
      }),
    );
    expect(lastJob(runId)).toMatchObject({
      type: 'ingest',
      payload: { refetchSourceIds: [source!.id] },
    });

    await h.drain({ researcher: h.recording('researcher') }, 2);
    expectWaitingAt(runId, 'gate_research');
    expect(h.jobs(runId)).toEqual(['ingest', 'research', 'ingest', 'research']);
    const reused = h.logs(runId).filter((l) => l.includes('already extracted, reused'));
    expect(reused.some((l) => l.startsWith(`Source ${source!.id} `))).toBe(false);
    expect(listRunSources(h.t.db, runId).map((s) => s.sourceId)).toContain(source!.id);
  });
});

describe('regenerate at the beat-sheet gate', () => {
  it('runs the Director again with the feedback', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const sent = prompts(runId, 'director').length;
    await decided(
      await h.post(runId, 'beat_sheet', {
        action: 'regenerate',
        target: 'director',
        feedback: FEEDBACK,
      }),
    );
    await h.drain({ director: h.recording('director') }, 1);
    expectWaitingAt(runId, 'gate_beat_sheet');
    expect(latestDirection(h.t.db, h.t.dataDir, runId)!.input.feedback).toBe(FEEDBACK);
    const all = prompts(runId, 'director');
    expect(all.slice(0, sent).some(hasFeedback)).toBe(false);
    // The rerun (its repair attempts too) carries the feedback.
    expect(all.slice(sent).length).toBeGreaterThan(0);
    expect(all.slice(sent).every(hasFeedback)).toBe(true);
  });
});

describe('regenerate at the scenes gate', () => {
  it('the Scriptwriter: script, TTS, boards, re-time and curate again', async () => {
    const runId = await h.runUntilWaiting({ research: true, beat_sheet: true }, { curator: QUIET });
    const mark = h.lastEventId(runId);
    await decided(
      await h.post(runId, 'scenes', {
        action: 'regenerate',
        target: 'scriptwriter',
        feedback: FEEDBACK,
      }),
    );
    await h.drain({ scriptwriter: h.recording('scriptwriter'), curator: QUIET });
    expectWaitingAt(runId, 'gate_scenes');
    expect(h.stepsAfter(runId, mark)).toEqual([
      'script',
      'spec',
      'tts',
      'generate',
      'board_backlog',
      'retime',
      'curate',
      'stills',
      'gate_scenes',
    ]);
    const scriptPrompts = prompts(runId, 'scriptwriter');
    expect(hasFeedback(scriptPrompts.at(-1)!)).toBe(true);
    expect(scriptPrompts.filter(hasFeedback).length).toBeGreaterThan(0);
    expect(getGate(h.t.db, runId, 'scenes')!.status).toBe('pending');
  });

  it('the Generator: every board drawn again with the feedback, then re-time and curate', async () => {
    const runId = await h.runUntilWaiting({ research: true, beat_sheet: true }, { curator: QUIET });
    const mark = h.lastEventId(runId);
    const drawnBefore = prompts(runId, 'generator').length;
    await decided(
      await h.post(runId, 'scenes', {
        action: 'regenerate',
        target: 'generator',
        feedback: FEEDBACK,
      }),
    );
    expect(lastJob(runId).payload).toMatchObject({ redraw: true, feedback: FEEDBACK });
    await h.drain({ generator: h.recordedBoards(), curator: QUIET });
    expectWaitingAt(runId, 'gate_scenes');
    expect(h.stepsAfter(runId, mark)).toEqual([
      'generate',
      'board_backlog',
      'retime',
      'curate',
      'stills',
      'gate_scenes',
    ]);
    const redrawn = prompts(runId, 'generator').slice(drawnBefore);
    expect(redrawn).toHaveLength(SPEC.story.beats.length);
    expect(redrawn.every(hasFeedback)).toBe(true);
  });

  it('one beat: its named fields revised, a scoped curate, every other beat byte-identical', async () => {
    const runId = await h.runUntilWaiting({ research: true, beat_sheet: true }, { curator: QUIET });
    const reviewed = getLatestSpecVersion(h.t.db, runId)!;
    const before = h.spec(reviewed.id);
    for (const bad of [
      { target: 'beat', beatId: BEAT, fields: ['headline'] },
      { target: 'beat', beatId: BEAT, fields: ['plan'], feedback: FEEDBACK },
      { target: 'beat', beatId: '<example-unknown>', fields: ['headline'], feedback: FEEDBACK },
      { target: 'researcher', feedback: FEEDBACK },
    ]) {
      await expectError(
        await h.post(runId, 'scenes', { action: 'regenerate', ...bad } as never),
        400,
      );
    }

    const mark = h.lastEventId(runId);
    await decided(
      await h.post(runId, 'scenes', {
        action: 'regenerate',
        target: 'beat',
        beatId: BEAT,
        fields: ['headline'],
        feedback: FEEDBACK,
      }),
    );
    expect(lastJob(runId)).toMatchObject({
      type: 'repair',
      payload: {
        requests: [
          {
            beatId: BEAT,
            owner: 'scriptwriter',
            fields: ['headline'],
            issues: [{ code: 'reviewer_feedback', message: FEEDBACK }],
          },
        ],
      },
    });
    await h.drain({
      scriptwriter: [revisedHeadline(before, BEAT, 'Word counts miss the real tokens')],
      curator: reviewOf(before, [], []),
    });
    expectWaitingAt(runId, 'gate_scenes');
    expect(h.stepsAfter(runId, mark)).toEqual(['repair', 'curate', 'stills', 'gate_scenes']);
    const curation = latestCuration(h.t.db, h.t.dataDir, runId)!;
    expect(curation.report.scope).toEqual({
      sinceSpecVersionId: reviewed.id,
      changedBeatIds: [BEAT],
    });
    const after = h.spec(curation.report.final.specVersionId);
    expect(after.script.find((b) => b.beatId === BEAT)!.headline?.text).toBe(
      'Word counts miss the real tokens',
    );
    expectOthersUnchanged(before, after, BEAT);
    expect(hasFeedback(prompts(runId, 'scriptwriter').at(-1)!)).toBe(true);
  });
});

describe('regenerate at the draft gate', () => {
  it('one beat: the G3 path, only its clip renders again, the scenes gate decided at G4', async () => {
    const runId = await h.runUntilWaiting(
      { research: true, beat_sheet: true, scenes: true },
      { curator: QUIET },
    );
    expectWaitingAt(runId, 'gate_draft');
    const reviewed = getLatestSpecVersion(h.t.db, runId)!;
    const before = h.spec(reviewed.id);
    const mark = h.lastEventId(runId);
    const scriptCalls = prompts(runId, 'scriptwriter').length;
    const res = await decided(
      await h.post(runId, 'draft', {
        action: 'regenerate',
        target: 'beat',
        beatId: BEAT,
        fields: ['board'],
        feedback: FEEDBACK,
      }),
    );
    // The repair carries the decision it was asked by, and only the Generator's request.
    expect(lastJob(runId)).toMatchObject({
      type: 'repair',
      payload: {
        decisionEventId: res.eventId,
        requests: [{ beatId: BEAT, owner: 'generator', fields: ['board'] }],
      },
    });
    expect(getGate(h.t.db, runId, 'scenes')).toMatchObject({
      status: 'approved',
      carriedFrom: 'draft',
    });
    await h.drain({
      generator: { [BEAT]: [boardWithSemantic(before, BEAT, 'rare-card', 'concept')] },
      curator: reviewOf(before, [], []),
    });
    expectWaitingAt(runId, 'gate_draft');
    expect(h.stepsAfter(runId, mark)).toEqual([
      'repair',
      'curate',
      'stills',
      'gate_scenes',
      'draft',
      'gate_draft',
    ]);
    const clips = h.renders.videos
      .map((v) => v.outPath)
      .filter((p) => p.includes('/beats/'))
      .map((p) => p.split('/').at(-1)!.split('.')[0]);
    expect(clips).toEqual([BEAT]);

    const after = h.spec(getLatestSpecVersion(h.t.db, runId)!.id);
    const card = after.scenes
      .find((s) => s.beatId === BEAT)!
      .elements.find((e) => e.id === 'rare-card')!;
    expect(card.props).toMatchObject({ semantic: 'concept' });
    expectOthersUnchanged(before, after, BEAT);
    const scenes = await h.gate(runId, 'scenes');
    expect(scenes).toMatchObject({ status: 'approved', carriedFrom: 'draft' });
    expect(scenes.subject).toMatchObject({ id: getLatestSpecVersion(h.t.db, runId)!.id });
    const draft = await h.gate(runId, 'draft');
    expect(draft).toMatchObject({ status: 'pending', waiting: true });
    expect(hasFeedback(prompts(runId, 'generator').at(-1)!)).toBe(true);
    // A board-only fix never calls the Scriptwriter.
    expect(prompts(runId, 'scriptwriter')).toHaveLength(scriptCalls);
    const changed = {
      decisionEventId: res.eventId,
      requests: [{ beatId: BEAT, owner: 'generator', fields: ['board'], outcome: 'changed' }],
    };
    expect(draft.regenerated).toEqual(changed);
    expect(reopened(runId, 'draft')?.payload.regenerated).toEqual(changed);
  });

  it('a regenerate that changes nothing says so: the gate event and the payload', async () => {
    const runId = await h.runUntilWaiting(
      { research: true, beat_sheet: true, scenes: true },
      { curator: QUIET },
    );
    const reviewed = getLatestSpecVersion(h.t.db, runId)!;
    const res = await decided(
      await h.post(runId, 'draft', {
        action: 'regenerate',
        target: 'beat',
        beatId: BEAT,
        fields: ['board'],
        feedback: FEEDBACK,
      }),
    );
    // Every attempt invalid: the Generator cannot make a valid board, so nothing is saved.
    const invalid = answer({ elements: 'not a list' });
    await h.drain({
      generator: { [BEAT]: [invalid, invalid, invalid] },
      curator: reviewOf(h.spec(reviewed.id), [], []),
    });
    expectWaitingAt(runId, 'gate_draft');
    expect(getLatestSpecVersion(h.t.db, runId)!.id).toBe(reviewed.id);

    const draft = await h.gate(runId, 'draft');
    const request = draft.regenerated?.requests[0];
    expect(draft.regenerated?.decisionEventId).toBe(res.eventId);
    expect(request).toMatchObject({ beatId: BEAT, owner: 'generator', outcome: 'unchanged' });
    expect(request?.reason).toMatch(/^the Generator could not make a valid change: /);
    expect(reopened(runId, 'draft')?.payload.regenerated).toEqual(draft.regenerated);
    expect(outcomeLine(request!)).toMatch(
      new RegExp(`^${BEAT} board: unchanged: the Generator could not`),
    );
    expect(readGate(h.t.db, h.t.dataDir, runId, 'draft').regenerated).toEqual(draft.regenerated);
  });
});

/** The newest `gate` event for the gate: the one that reopened it. */
function reopened(runId: number, gate: GateId) {
  return gateEvents(h.t.db, runId, gate)[0];
}

/** The Scriptwriter's revision of one beat: its script entry with a new headline. */
function revisedHeadline(spec: RenderableVideoSpec, beatId: string, text: string) {
  const entry = spec.script.find((b) => b.beatId === beatId)!;
  return answer({ script: [{ ...entry, headline: { ...entry.headline!, text } }] });
}

/**
 * The Generator's answer for one beat: its board as it was, one element in another semantic
 * (`rare-card` out of the focus colour: the Curator's own advice on the tokenizer's b6).
 */
function boardWithSemantic(
  spec: RenderableVideoSpec,
  beatId: string,
  elementId: string,
  semantic: string,
) {
  const board: Record<string, unknown> = { ...spec.scenes.find((s) => s.beatId === beatId)! };
  // What the plan decides is not the Generator's to answer.
  for (const key of ['beatId', 'kind', 'continuesPrevious', 'layoutMode']) delete board[key];
  const elements = (board.elements as RenderableVideoSpec['scenes'][number]['elements']).map((e) =>
    e.id === elementId ? { ...e, props: { ...e.props, semantic } } : e,
  );
  return answer({ ...board, elements });
}

function expectOthersUnchanged(
  before: RenderableVideoSpec,
  after: RenderableVideoSpec,
  beatId: string,
): void {
  const others = (spec: RenderableVideoSpec) => ({
    script: spec.script.filter((b) => b.beatId !== beatId),
    scenes: spec.scenes.filter((s) => s.beatId !== beatId),
  });
  expect(JSON.stringify(others(after))).toBe(JSON.stringify(others(before)));
}
