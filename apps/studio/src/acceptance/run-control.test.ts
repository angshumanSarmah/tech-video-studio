import { readFileSync } from 'node:fs';
import { RunDtoSchema } from '@explainer-studio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPath } from '#core/data-files.ts';
import { listRunJobs } from '#core/db/repositories/jobs.ts';
import { listRunLlmCalls, runCostUsd } from '#core/db/repositories/llm-calls.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { latestResearch } from '#core/services/research-notes.ts';
import { curateRound, reviewOf } from '#worker/agents/curator/testing.ts';
import { fixtureGeneratedSpec } from '#worker/agents/generator/testing.ts';
import { decided, expectError, Harness } from './harness.ts';

/**
 * P1C.9 steps 6 and 7's acceptance, through the API and the dry-run worker: a worker killed in
 * the middle of `generate` finishes after a restart without paying again for finished beats; a
 * cancel during `generate` ends the run within 2 s with nothing queued after; a failed run
 * resumes from its failed step; a cost cap below the Director's cost pauses the run at `direct`
 * and raising it completes the run with at most one extra call billed.
 */

const TOPIC = 'tokenizer';
const AUTO = { research: true, beat_sheet: true, scenes: true, draft: true };
const QUIET = { curator: reviewOf(fixtureGeneratedSpec(TOPIC)) };
/** Jobs before `generate`: ingest, research, direct, script, tts. */
const BEFORE_GENERATE = 5;

let h: Harness;

beforeEach(() => {
  h = new Harness(TOPIC);
});

afterEach(() => h.cleanup());

/** A run with every gate on auto, its `generate` job queued. */
async function atGenerate(): Promise<number> {
  const runId = h.start({ autoApprove: AUTO });
  await h.drain({}, BEFORE_GENERATE);
  expect(listRunJobs(h.t.db, runId).at(-1)).toMatchObject({ type: 'generate', status: 'queued' });
  return runId;
}

/** The beat each of the run's Generator calls drew (its replay key), in call order. */
function generatorBeats(runId: number): string[] {
  return listRunLlmCalls(h.t.db, runId)
    .filter((c) => c.role === 'generator' && c.responsePath !== null)
    .map((c) => {
      const text = readFileSync(resolveDataPath(h.t.dataDir, c.promptPath), 'utf8');
      return (JSON.parse(text) as { replayKey: string }).replayKey;
    });
}

function post(path: string): Promise<Response> {
  return Promise.resolve(h.app.request(path, { method: 'POST' }));
}

describe('a worker killed during generate', () => {
  it('finishes after a restart without paying again for finished beats', async () => {
    const runId = await atGenerate();
    const beats = fixtureGeneratedSpec(TOPIC).story.beats.map((b) => b.id);
    h.hangAfter('generator', 3, false);
    void h.runOne();
    await h.until(() => generatorBeats(runId).length === 3 && h.hung > 0);
    const paid = generatorBeats(runId);

    // The process is gone: its calls never return. A new worker starts.
    h.restart();
    expect(listRunJobs(h.t.db, runId).at(-1)).toMatchObject({ type: 'generate', status: 'queued' });
    await h.drain(QUIET);

    expect(getRun(h.t.db, runId)!.status).toBe('done');
    const drawn = generatorBeats(runId);
    expect([...drawn].sort()).toEqual([...beats].sort());
    expect(drawn.slice(0, 3)).toEqual(paid);
    expect(h.jobs(runId).filter((j) => j === 'generate')).toHaveLength(1);
  });
});

describe('cancel', () => {
  it('during generate: the run ends within 2 s, the job is cancelled, nothing is queued after', async () => {
    const runId = await atGenerate();
    h.hangAfter('generator', 0, true);
    const running = h.runOne();
    await h.until(() => h.hung > 0);

    const started = Date.now();
    const res = await post(`/api/runs/${runId}/cancel`);
    expect(res.status).toBe(200);
    expect(RunDtoSchema.parse(await res.json()).status).toBe('cancelled');
    await running;
    expect(Date.now() - started).toBeLessThan(2_000);

    expect(getRun(h.t.db, runId)!.status).toBe('cancelled');
    const jobs = listRunJobs(h.t.db, runId);
    expect(jobs.at(-1)).toMatchObject({ type: 'generate', status: 'cancelled' });
    expect(jobs.filter((j) => j.status === 'queued' || j.status === 'running')).toEqual([]);
    await h.drain(QUIET);
    expect(listRunJobs(h.t.db, runId)).toHaveLength(jobs.length);
    await expectError(await post(`/api/runs/${runId}/cancel`), 409);
  });

  it('a run waiting at a gate: cancelled at once, its queued jobs too', async () => {
    const runId = await h.runUntilWaiting({});
    const res = await post(`/api/runs/${runId}/cancel`);
    expect(res.status).toBe(200);
    expect(getRun(h.t.db, runId)).toMatchObject({ status: 'cancelled' });
    await expectError(await h.post(runId, 'research', { action: 'reject' }), 409);
  });
});

describe('resume', () => {
  it('a failed run goes on from its failed step', async () => {
    h.drop('director');
    const runId = await h.runUntilWaiting({ research: true });
    expect(getRun(h.t.db, runId)).toMatchObject({ status: 'failed', pipelineStep: 'direct' });

    const res = await post(`/api/runs/${runId}/resume`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(getRun(h.t.db, runId)).toMatchObject({ status: 'running', pipelineStep: 'direct' });
    expect(listRunJobs(h.t.db, runId).map((j) => [j.type, j.status])).toEqual([
      ['ingest', 'done'],
      ['research', 'done'],
      ['direct', 'failed'],
      ['direct', 'queued'],
    ]);
    await h.drain({ director: h.recording('director') });
    expect(getRun(h.t.db, runId)).toMatchObject({
      status: 'awaiting_review',
      pipelineStep: 'gate_beat_sheet',
    });
    await expectError(await post(`/api/runs/${runId}/resume`), 409);
  });
});

describe('the cost cap', () => {
  it('below the Director’s cost: pauses at direct; raising it completes the run', async () => {
    const runId = h.start({ autoApprove: { beat_sheet: true, scenes: true, draft: true } });
    await h.drain();
    const research = runCostUsd(h.t.db, runId);
    expect(research).toBeGreaterThan(0);

    // Enough for the Director's first attempt, not for its repair.
    const cap = await h.putSettings(runId, { budget: { maxRunUsd: research + 1e-6 } });
    expect(cap.status, await cap.clone().text()).toBe(200);
    const notes = latestResearch(h.t.db, h.t.dataDir, runId)!;
    await decided(await h.post(runId, 'research', { action: 'approve', subjectId: notes.step.id }));
    await h.drain();

    expect(getRun(h.t.db, runId)).toMatchObject({ status: 'paused', pipelineStep: 'direct' });
    const direct = listRunJobs(h.t.db, runId).at(-1)!;
    expect(direct).toMatchObject({ type: 'direct', status: 'queued', attempts: 0 });
    expect(h.logs(runId).at(-1)).toContain('raise the cap to resume');
    const gate = await h.gate(runId, 'research');
    expect(gate.cost.byRole.map((r) => r.role).sort()).toEqual(['director', 'researcher']);
    expect(gate.cost.byRole.every((r) => r.costUsd > 0)).toBe(true);

    // Paused: the queue skips its job.
    const billed = listRunLlmCalls(h.t.db, runId).length;
    await h.drain();
    expect(listRunLlmCalls(h.t.db, runId)).toHaveLength(billed);

    const raised = await h.putSettings(runId, { budget: { maxRunUsd: 5 } });
    expect(raised.status, await raised.clone().text()).toBe(200);
    expect(getRun(h.t.db, runId)!.status).toBe('running');
    expect(h.logs(runId).at(-1)).toContain('Resumed');
    const round = curateRound(TOPIC);
    await h.drain(round);
    expect(getRun(h.t.db, runId)!.status).toBe('done');

    // Every recorded answer once, at most one more call billed for the paused attempt.
    const recorded =
      h.recording('researcher').length +
      h.recording('director').length +
      h.recording('scriptwriter').length +
      Object.values(h.recordedBoards()).flat().length +
      round.curator.length +
      round.scriptwriter.length +
      Object.values(round.generator).flat().length;
    const calls = listRunLlmCalls(h.t.db, runId).filter((c) => c.costUsd > 0);
    expect(calls.length).toBeLessThanOrEqual(recorded + 1);
  });
});
