import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideGate, getGate, openGate } from '../db/repositories/gates.ts';
import { enqueueJob } from '../db/repositories/jobs.ts';
import { latestDoneStep, startRunStep, finishRunStep } from '../db/repositories/run-steps.ts';
import { createRun, getRun, setActiveRunStatus, setPipelineStep } from '../db/repositories/runs.ts';
import { series } from '../db/schema.ts';
import { createTopic } from '../db/repositories/topics.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '../db/testing.ts';
import { ConflictError } from '../errors.ts';
import { nextGate, rerunRequests, rerunRun } from './run-control.ts';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
});

afterEach(() => t.cleanup());

/** A run waiting at the beat sheet with gate 1 approved on a finished research step. */
function atBeatSheet(): number {
  const topicId = createTopic(t.db, { title: 'Rings' }).id;
  const seriesId = t.db.select().from(series).all()[0]!.id;
  const run = createRun(t.db, {
    topicId,
    seriesId,
    app: TEST_APP_SETTINGS,
    settings: { autoApprove: { research: true } },
  });
  const step = startRunStep(t.db, { runId: run.id, stage: 'research' });
  finishRunStep(t.db, step.id, 'runs/1/research/notes.json');
  openGate(t.db, run.id, 'research', { subjectStepId: step.id });
  decideGate(t.db, run.id, 'research', { status: 'approved', decidedBy: 'auto' });
  setPipelineStep(t.db, run.id, 'gate_beat_sheet', null);
  setActiveRunStatus(t.db, run.id, 'awaiting_review');
  return run.id;
}

describe('rerunRun', () => {
  it('sends the run back, reopening the gates after the step and holding the next one for --only', () => {
    const runId = atBeatSheet();
    expect(latestDoneStep(t.db, runId, 'research')).toBeDefined();
    rerunRun(t.db, t.dataDir, runId, { from: 'research', only: true });
    const run = getRun(t.db, runId)!;
    expect(run).toMatchObject({
      status: 'running',
      pipelineStep: 'research',
      holdGate: 'research',
    });
    expect(getGate(t.db, runId, 'research')!.status).toBe('pending');
  });

  it('refuses a cancelled run, a busy one, and a step the run has not reached', () => {
    const runId = atBeatSheet();
    expect(() => rerunRun(t.db, t.dataDir, runId, { from: 'generate', only: false })).toThrow(
      /has not reached generate yet/,
    );
    enqueueJob(t.db, { type: 'noop', runId, payload: { steps: 1, stepMs: 0 } });
    expect(() => rerunRun(t.db, t.dataDir, runId, { from: 'research', only: false })).toThrow(
      /is busy/,
    );
    setActiveRunStatus(t.db, runId, 'cancelled');
    expect(() => rerunRun(t.db, t.dataDir, runId, { from: 'research', only: false })).toThrow(
      ConflictError,
    );
  });

  it('asks for fresh boards from the Generator, and no repairs from an --only curate', () => {
    expect(rerunRequests({ from: 'generate', only: true })).toEqual({
      generate: { redraw: true },
      curate: { repair: false },
    });
    expect(rerunRequests({ from: 'generate', only: false })).toEqual({
      generate: { redraw: true },
    });
    expect(rerunRequests({ from: 'curate', only: true })).toEqual({});
    expect(nextGate('generate')).toBe('scenes');
    expect(nextGate('draft')).toBe('draft');
    expect(nextGate('final')).toBeNull();
  });
});
