import { RunDtoSchema, type RenderableVideoSpec } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGate } from '#core/db/repositories/gates.ts';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls } from '#core/db/repositories/llm-calls.ts';
import { getRunStep } from '#core/db/repositories/run-steps.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { getLatestSpecVersion, getSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { InvalidEditError } from '#core/errors.ts';
import { latestCuration } from '#core/services/curation.ts';
import { latestDirection } from '#core/services/direction.ts';
import { prepareSpecEdit } from '#core/services/gate-edits.ts';
import { reviewOf } from '#worker/agents/curator/testing.ts';
import { fixtureGeneratedSpec } from '#worker/agents/generator/testing.ts';
import { decided, expectError, gateSpec, Harness } from './harness.ts';

/**
 * P1C.9 step 4's acceptance, through the HTTP API and the real worker (dry run, `Harness`): a run
 * pauses at the beat-sheet gate and resumes on approve; an edit at the scenes gate is saved as
 * the user's version, re-timed and curated again; a stale approve is a 409; updating the run's
 * settings at a gate changes the next job's model and nothing else. The Curator answers with a
 * review that flags nothing (`reviewOf`).
 */

const TOPIC = 'tokenizer';
/** A model of the default price table other than the default Scriptwriter's. */
const OTHER_MODEL = 'deepseek-v4-pro';
const QUIET = { curator: reviewOf(fixtureGeneratedSpec(TOPIC)) };

let h: Harness;

beforeEach(() => {
  h = new Harness(TOPIC);
});

afterEach(() => h.cleanup());

const t = () => h.t;

describe('the beat-sheet gate, through the API', () => {
  it('pauses the run and resumes it on approve; a stale approve is a 409', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const gate = await h.gate(runId, 'beat_sheet');
    const plan = latestDirection(t().db, t().dataDir, runId)!;
    expect(gate).toMatchObject({
      status: 'pending',
      waiting: true,
      subject: { kind: 'step', id: plan.step.id },
      content: { gate: 'beat_sheet', plan: plan.plan },
      // The recorded plan passed the Director's checks; the gate runs the same ones.
      checks: [],
      blocking: [],
    });
    expect(gate.cost.byRole.map((r) => r.role).sort()).toEqual(['director', 'researcher']);

    const research = getGate(t().db, runId, 'research')!;
    const stale = await h.post(runId, 'beat_sheet', {
      action: 'approve',
      subjectId: research.subjectStepId!,
    });
    expect((await expectError(stale, 409)).message).toContain('reload it');
    expect(getRun(t().db, runId)!.status).toBe('awaiting_review');

    const approved = await decided(
      await h.post(runId, 'beat_sheet', {
        action: 'approve',
        subjectId: plan.step.id,
        notes: '<example-note>',
      }),
    );
    expect(approved.run).toEqual({ status: 'running', step: 'script' });
    expect(await h.gate(runId, 'beat_sheet')).toMatchObject({
      status: 'approved',
      decidedBy: 'user',
      notes: '<example-note>',
      waiting: false,
    });
    // Approved once: a second decision has no gate waiting for it.
    await expectError(await h.post(runId, 'beat_sheet', { action: 'reject' }), 409);

    await h.drain(QUIET);
    expect(getRun(t().db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_scenes',
    });
  });

  it('cancels the run on reject', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const res = await decided(await h.post(runId, 'beat_sheet', { action: 'reject' }));
    expect(res.run.status).toBe('cancelled');
    expect(getGate(t().db, runId, 'beat_sheet')).toMatchObject({
      status: 'rejected',
      decidedBy: 'user',
    });
  });

  it('saves an edit as the user’s step and reviews it again', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const before = latestDirection(t().db, t().dataDir, runId)!;
    const plan = structuredClone(before.plan);
    plan.meta.title = `${plan.meta.title}!`;

    const res = await decided(
      await h.post(runId, 'beat_sheet', {
        action: 'edit',
        subjectId: before.step.id,
        content: plan,
      }),
    );
    expect(res.saved).toMatchObject({ kind: 'step' });
    expect(res.run).toEqual({ status: 'awaiting_review', step: 'gate_beat_sheet' });
    const step = getRunStep(t().db, res.saved!.id)!;
    expect(step).toMatchObject({
      stage: 'direct',
      createdBy: 'user',
      inputPath: before.step.inputPath,
    });
    const gate = await h.gate(runId, 'beat_sheet');
    expect(gate.subject).toEqual({ kind: 'step', id: step.id });
    expect(gate.content).toMatchObject({ plan: { meta: { title: plan.meta.title } } });

    const invalid = await h.post(runId, 'beat_sheet', {
      action: 'edit',
      subjectId: step.id,
      content: { ...plan, story: undefined },
    });
    const error = await expectError(invalid, 400);
    expect(error.issues?.map((i) => i.path)).toContain('$.story');
  });

  it('regenerates the beat sheet: the run goes back to the Director', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const res = await decided(
      await h.post(runId, 'beat_sheet', { action: 'regenerate', target: 'director' }),
    );
    expect(res.run).toEqual({ status: 'running', step: 'direct' });
    expect(h.jobs(runId)).toEqual(['ingest', 'research', 'direct', 'direct']);
    expect(getGate(t().db, runId, 'beat_sheet')!.status).toBe('pending');
    expect(h.logs(runId).at(-1)).toContain('Regenerate director at the beat_sheet gate');

    // The gate no longer waits: the Director is running again.
    await expectError(await h.post(runId, 'beat_sheet', { action: 'reject' }), 409);
    await expectError(
      await h.post(runId, 'research', { action: 'regenerate', target: 'researcher' }),
      409,
    );
  });
});

describe('the scenes gate, through the API', () => {
  it('saves an edit as a new version, re-times and curates it again; stale approves are 409s', async () => {
    const runId = await h.runUntilWaiting({ research: true, beat_sheet: true }, QUIET);
    const gate = await h.gate(runId, 'scenes');
    const reviewed = getLatestSpecVersion(t().db, runId)!;
    expect(gate).toMatchObject({
      waiting: true,
      subject: { kind: 'spec_version', id: reviewed.id, version: reviewed.version },
      blocking: [],
    });
    // The Curator's code findings on the tokenizer: advisory, so nothing blocks.
    expect(gate.badges.map((b) => `${b.beatId}:${b.code}:${b.severity}`)).toEqual([
      'b5:focus_colour_off_focus:advisory',
      'b6:focus_colour_off_focus:advisory',
      'null:video_over_target:advisory',
    ]);
    expect(gate.checks.map((c) => c.code)).toContain('video_over_target');
    expect(gate.stills.length).toBeGreaterThan(0);
    expect(gate.cost.byRole.map((r) => r.role)).toContain('curator');

    // One sentence added to b3's narration: its board's anchors stay on their words.
    const spec = structuredClone(gateSpec(gate));
    const beat = spec.script!.find((b) => b.beatId === 'b3')!;
    beat.narration = `${beat.narration} That is the whole trick.`;
    const edit = await decided(
      await h.post(runId, 'scenes', { action: 'edit', subjectId: reviewed.id, content: spec }),
    );
    expect(edit.run).toEqual({ status: 'running', step: 'edit_retime' });
    const userVersion = getSpecVersion(t().db, edit.saved!.id)!;
    expect(userVersion).toMatchObject({ createdBy: 'user', version: reviewed.version + 1 });

    // Approving what the run no longer reviews, while it re-times: no gate waits.
    await expectError(
      await h.post(runId, 'scenes', { action: 'approve', subjectId: reviewed.id }),
      409,
    );

    await h.drain({ curator: reviewOf(spec as RenderableVideoSpec) });
    expect(getRun(t().db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_scenes',
    });
    expect(h.jobs(runId).slice(-3)).toEqual(['tts', 'curate', 'render_stills']);
    const retimed = getLatestSpecVersion(t().db, runId)!;
    expect(retimed).toMatchObject({ createdBy: 'agent', version: userVersion.version + 1 });
    const curate = listRunJobs(t().db, runId).at(-2)!;
    expect(curate.payload).toEqual({ specVersionId: retimed.id, repair: false });
    expect(latestCuration(t().db, t().dataDir, runId)!.report.final.specVersionId).toBe(retimed.id);

    const again = await h.gate(runId, 'scenes');
    expect(again.subject).toMatchObject({ id: retimed.id });
    expect(again.stills.length).toBeGreaterThan(0);
    for (const stale of [reviewed.id, userVersion.id]) {
      await expectError(
        await h.post(runId, 'scenes', { action: 'approve', subjectId: stale }),
        409,
      );
    }
    const approved = await decided(
      await h.post(runId, 'scenes', { action: 'approve', subjectId: retimed.id }),
    );
    expect(approved.run).toEqual({ status: 'running', step: 'draft' });
  });
});

describe('updating run settings', () => {
  it('at a gate: only the named fields change, for the next job; never during a job', async () => {
    const runId = await h.runUntilWaiting({ research: true });
    const run = getRun(t().db, runId)!;
    const before = run.resolvedSettings;
    expect(before.llm.models.scriptwriter).not.toBe(OTHER_MODEL);
    // settings.json changed since the run started: the update must not pick that up.
    h.settings = { ...h.settings, research: { ...h.settings.research, sourceTokenBudget: 1_234 } };

    const res = await h.putSettings(runId, { llm: { models: { scriptwriter: OTHER_MODEL } } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(RunDtoSchema.parse(await res.json()).settings.llm).toEqual({
      models: { scriptwriter: OTHER_MODEL },
    });
    expect(getRun(t().db, runId)!.resolvedSettings).toEqual({
      ...before,
      llm: { ...before.llm, models: { ...before.llm.models, scriptwriter: OTHER_MODEL } },
    });
    expect(h.logs(runId).at(-1)).toBe(
      `Run settings updated: settings.llm.models.scriptwriter: unset → "${OTHER_MODEL}"; ` +
        `snapshot.llm.models.scriptwriter: "${before.llm.models.scriptwriter}" → "${OTHER_MODEL}".`,
    );
    await expectError(
      await h.putSettings(runId, { llm: { models: { director: '<example>' } } }),
      400,
    );

    const plan = latestDirection(t().db, t().dataDir, runId)!;
    await decided(
      await h.post(runId, 'beat_sheet', { action: 'approve', subjectId: plan.step.id }),
    );
    const busy = await h.putSettings(runId, { budget: { maxRunUsd: 1 } });
    expect((await expectError(busy, 409)).message).toContain('1 job(s) active');

    await h.drain({}, 1);
    const calls = listRunLlmCalls(t().db, runId);
    const models = (role: string) => [
      ...new Set(calls.filter((c) => c.role === role).map((c) => c.model)),
    ];
    expect(models('scriptwriter')).toEqual([OTHER_MODEL]);
    expect(models('director')).toEqual([before.llm.models.director]);
    expect(models('researcher')).toEqual([before.llm.models.researcher]);
  });
});

describe('prepareSpecEdit', () => {
  const spec = fixtureGeneratedSpec(TOPIC);

  it('drops the timing of a narration edit and moves its board onto the new words', () => {
    const edited = structuredClone(spec);
    const beat = edited.script.find((b) => b.beatId === 'b3')!;
    beat.narration = `Look. ${beat.narration}`;
    const result = prepareSpecEdit(spec, edited, 0);
    expect(result.retime).toBe(true);
    expect(result.spec.timing).toBeUndefined();
    const before = spec.scenes.find((s) => s.beatId === 'b3')!;
    const after = result.spec.scenes!.find((s) => s.beatId === 'b3')!;
    const wordAnchors = (s: typeof before) =>
      s.events.flatMap((e) => (e.at.type === 'word' ? [e.at.index] : []));
    expect(wordAnchors(before).length).toBeGreaterThan(0);
    expect(wordAnchors(after)).toEqual(wordAnchors(before).map((i) => i + 1));
  });

  it('keeps the timing of a board edit (re-timed only while landing holds are on)', () => {
    const edited = structuredClone(spec);
    const scene = edited.scenes.find((s, i) => i > 0 && !s.continuesPrevious)!;
    scene.transitionIn = scene.transitionIn === 'fade' ? 'cut' : 'fade';
    expect(prepareSpecEdit(spec, edited, 0)).toMatchObject({
      retime: false,
      spec: { timing: { events: [] } },
    });
    expect(prepareSpecEdit(spec, edited, 0.4).retime).toBe(true);
  });

  it('refuses an edit that is not a valid spec', () => {
    const edited = structuredClone(spec);
    edited.scenes[0]!.beatId = '<example-unknown-beat>';
    expect(() => prepareSpecEdit(spec, edited, 0)).toThrow(InvalidEditError);
    expect(() => prepareSpecEdit(spec, { meta: {} }, 0)).toThrow(InvalidEditError);
  });
});
