import { PIPELINE_STEP_IDS, type PipelineStepId } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { decide, regenerateRoute, RegenerateNotAllowedError, type RunSnapshot } from './decide.ts';
import { nextStep, PIPELINE } from './pipeline.ts';

const AUTO_OFF = { research: false, beat_sheet: false, scenes: false, draft: false };
const AUTO_ON = { research: true, beat_sheet: true, scenes: true, draft: true };

const snap = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  status: 'running',
  step: 'ingest',
  stepJob: null,
  otherActiveJobs: 0,
  gate: null,
  blocking: [],
  autoApprove: AUTO_OFF,
  part: null,
  parts: null,
  ...over,
});

const JOB_STEPS = PIPELINE_STEP_IDS.filter((id) => PIPELINE[id].kind === 'job');
const GATE_STEPS = PIPELINE_STEP_IDS.filter((id) => PIPELINE[id].kind === 'gate');

describe('decide: job steps', () => {
  it.each(JOB_STEPS)('%s: queues its job, waits for it, then moves on', (step) => {
    expect(decide(snap({ step }))).toEqual({ kind: 'enqueue', step });
    expect(decide(snap({ step, stepJob: { status: 'queued' } })).kind).toBe('idle');
    expect(decide(snap({ step, stepJob: { status: 'running' } })).kind).toBe('idle');
    expect(decide(snap({ step, stepJob: { status: 'done' } }))).toEqual({
      kind: 'advance',
      to: nextStep(step),
    });
  });

  it('stops on a failed job; the run itself is failed by the job service', () => {
    expect(decide(snap({ step: 'generate', stepJob: { status: 'failed' } })).kind).toBe('idle');
    expect(decide(snap({ step: 'generate', stepJob: { status: 'cancelled' } })).kind).toBe('idle');
  });

  it('goes on past failed stills (previews only)', () => {
    expect(decide(snap({ step: 'stills', stepJob: { status: 'failed' } }))).toEqual({
      kind: 'advance',
      to: 'gate_scenes',
    });
  });

  it('does not queue next to another active job of the run', () => {
    expect(decide(snap({ step: 'tts', otherActiveJobs: 1 })).kind).toBe('idle');
  });
});

describe('decide: the order', () => {
  it('walks the whole pipeline, with stills before the scenes gate and no detours', () => {
    const order: PipelineStepId[] = ['ingest'];
    while (order.at(-1) !== 'done') order.push(nextStep(order.at(-1)!));
    expect(order).toEqual([
      'ingest',
      'research',
      'gate_research',
      'direct',
      'gate_beat_sheet',
      'split',
      'script',
      'spec',
      'tts',
      'generate',
      'board_backlog',
      'retime',
      'curate',
      'stills',
      'gate_scenes',
      'draft',
      'gate_draft',
      'final',
      'done',
    ]);
  });

  it.each(['split', 'spec', 'board_backlog'] as const)('%s is a transition', (step) => {
    expect(decide(snap({ step }))).toEqual({ kind: 'effect', step, then: nextStep(step) });
  });

  it('finishes at the end', () => {
    expect(decide(snap({ step: 'done' }))).toEqual({ kind: 'finish', status: 'done' });
  });
});

describe('decide: gates', () => {
  it.each(GATE_STEPS)('%s: opens, then waits for review when auto-approve is off', (step) => {
    const gate = PIPELINE[step].kind === 'gate' ? PIPELINE[step].gate : undefined;
    expect(decide(snap({ step }))).toEqual({ kind: 'open_gate', gate });
    const pending = snap({ step, gate: { status: 'pending', current: true } });
    expect(decide(pending)).toEqual({ kind: 'await_review', gate });
    expect(decide({ ...pending, status: 'awaiting_review' }).kind).toBe('idle');
  });

  it.each(GATE_STEPS)('%s: auto-approves when on and nothing blocks', (step) => {
    const pending = snap({
      step,
      autoApprove: AUTO_ON,
      gate: { status: 'pending', current: true },
    });
    expect(decide(pending).kind).toBe('approve_gate');
  });

  it.each(GATE_STEPS)('%s: waits for review when on but something blocks', (step) => {
    const blocked = snap({
      step,
      autoApprove: AUTO_ON,
      gate: { status: 'pending', current: true },
      blocking: ['<example-blocking-issue>'],
    });
    expect(decide(blocked).kind).toBe('await_review');
  });

  it('moves on from an approved gate, and cancels the run on a rejected one', () => {
    const approved = snap({ step: 'gate_scenes', gate: { status: 'approved', current: true } });
    expect(decide(approved)).toEqual({ kind: 'advance', to: 'draft' });
    const rejected = snap({ step: 'gate_scenes', gate: { status: 'rejected', current: true } });
    expect(decide(rejected)).toEqual({ kind: 'finish', status: 'cancelled' });
  });

  it('resumes from awaiting review once a decision arrives', () => {
    const decided = snap({
      step: 'gate_beat_sheet',
      status: 'awaiting_review',
      gate: { status: 'approved', current: true },
    });
    expect(decide(decided)).toEqual({ kind: 'advance', to: 'split' });
  });

  it('keeps an approval reached again with a new subject, and reopens a pending one', () => {
    const carried = snap({ step: 'gate_scenes', gate: { status: 'approved', current: false } });
    expect(decide(carried)).toEqual({ kind: 'carry_gate', gate: 'scenes' });
    const stale = snap({ step: 'gate_scenes', gate: { status: 'pending', current: false } });
    expect(decide(stale)).toEqual({ kind: 'open_gate', gate: 'scenes' });
  });
});

describe('decide: paused, cancelled and finished runs', () => {
  it.each(['paused', 'cancelled', 'done', 'failed'] as const)('does nothing while %s', (status) => {
    expect(decide(snap({ status, step: 'generate' })).kind).toBe('idle');
    expect(decide(snap({ status, step: 'gate_scenes' })).kind).toBe('idle');
  });
});

describe('decide: parts', () => {
  it('lets part 1 start its script, and holds part 2 until part 1 has its spec', () => {
    expect(decide(snap({ step: 'script', part: { index: 1, previousReady: true } })).kind).toBe(
      'enqueue',
    );
    expect(decide(snap({ step: 'script', part: { index: 2, previousReady: false } }))).toEqual({
      kind: 'idle',
      reason: "part 2 waits for part 1's script",
    });
    expect(decide(snap({ step: 'script', part: { index: 2, previousReady: true } })).kind).toBe(
      'enqueue',
    );
  });

  it('holds nothing else for the part before (only the script reads it)', () => {
    expect(decide(snap({ step: 'tts', part: { index: 2, previousReady: false } })).kind).toBe(
      'enqueue',
    );
  });

  it('keeps the parent waiting until every part is over, then finishes it', () => {
    const at = (parts: RunSnapshot['parts']) => decide(snap({ step: 'children', parts }));
    expect(at(['done', 'running']).kind).toBe('idle');
    expect(at(['done', 'awaiting_review']).kind).toBe('idle');
    expect(at(['done', 'paused']).kind).toBe('idle');
    expect(at(['done', 'done'])).toEqual({ kind: 'finish', status: 'done' });
    expect(at(['done', 'failed'])).toEqual({ kind: 'finish', status: 'failed' });
    expect(at(['cancelled', 'done'])).toEqual({ kind: 'finish', status: 'failed' });
  });
});

describe('regenerateRoute', () => {
  it.each([
    ['research', 'researcher', 'research', ['research', 'beat_sheet', 'scenes', 'draft']],
    ['research', 'source', 'ingest', ['research', 'beat_sheet', 'scenes', 'draft']],
    ['beat_sheet', 'director', 'direct', ['beat_sheet', 'scenes', 'draft']],
    ['scenes', 'beat', 'repair', ['scenes', 'draft']],
    ['scenes', 'scriptwriter', 'script', ['scenes', 'draft']],
    ['scenes', 'generator', 'generate', ['scenes', 'draft']],
    ['draft', 'beat', 'repair', ['draft']],
    ['draft', 'scriptwriter', 'script', ['draft']],
    ['draft', 'generator', 'generate', ['draft']],
  ] as const)('%s / %s reruns from %s and reopens %j', (gate, target, from, reopen) => {
    expect(regenerateRoute(gate, target)).toEqual({ from, reopen });
  });

  it('from repair, the run curates again before the scenes gate', () => {
    expect(nextStep('repair')).toBe('curate');
  });

  it.each([
    ['research', 'director'],
    ['beat_sheet', 'beat'],
    ['scenes', 'researcher'],
  ] as const)('refuses %s / %s', (gate, target) => {
    expect(() => regenerateRoute(gate, target)).toThrow(RegenerateNotAllowedError);
  });
});
