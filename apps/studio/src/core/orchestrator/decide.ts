import {
  GATE_IDS,
  type GateId,
  type GateStatus,
  type JobStatus,
  type PipelineStepId,
  type RegenerateTarget,
  type RunStatus,
} from '@explainer-studio/shared';
import { GATE_STEPS, isAfter, nextStep, PIPELINE } from './pipeline.ts';

/**
 * The orchestrator's decision (P1C.9), pure: from what a run's rows say now to the one thing to
 * do next. `advanceRun` reads the snapshot, applies the action and asks again, until the answer
 * is to wait. Driven by `PIPELINE`; nothing here knows a job type.
 */

export interface RunSnapshot {
  readonly status: RunStatus;
  /** The step the run is in (`runs.pipeline_step`). */
  readonly step: PipelineStepId;
  /** The job the current step queued, if any. */
  readonly stepJob: { readonly status: JobStatus } | null;
  /** The run's other queued or running jobs. */
  readonly otherActiveJobs: number;
  /** At a gate step: its row (null before it is opened) and whether it reviews the current subject. */
  readonly gate: { readonly status: GateStatus; readonly current: boolean } | null;
  /** At a gate step: why it cannot be auto-approved (empty: nothing blocks). */
  readonly blocking: readonly string[];
  readonly autoApprove: Readonly<Record<GateId, boolean>>;
  /** At a gate step: the run asked for a review of this gate once (`resume --only`). */
  readonly held: boolean;
  /**
   * A part of a multi-part video: its number, and whether the part before it is ready for this
   * part's script (done, or its scenes gate approved: the recap reads approved narration).
   */
  readonly part: { readonly index: number; readonly previousReady: boolean } | null;
  /** At `children`: the statuses of the parts. */
  readonly parts: readonly RunStatus[] | null;
}

export type Action =
  /** Nothing to do now: a job is running, a review or another run is awaited, or it is over. */
  | { readonly kind: 'idle'; readonly reason: string }
  | { readonly kind: 'enqueue'; readonly step: PipelineStepId }
  | { readonly kind: 'advance'; readonly to: PipelineStepId }
  /** Run a transition; it goes on to `then` (a split with parts goes to `children` instead). */
  | { readonly kind: 'effect'; readonly step: PipelineStepId; readonly then: PipelineStepId }
  | { readonly kind: 'open_gate'; readonly gate: GateId }
  | { readonly kind: 'approve_gate'; readonly gate: GateId }
  /** An approved gate reached again with a new subject: keep its approval, update the subject. */
  | { readonly kind: 'carry_gate'; readonly gate: GateId }
  | { readonly kind: 'await_review'; readonly gate: GateId }
  | { readonly kind: 'finish'; readonly status: 'done' | 'failed' | 'cancelled' };

const IDLE_STATUSES: ReadonlySet<RunStatus> = new Set(['done', 'failed', 'cancelled', 'paused']);
const TERMINAL: ReadonlySet<RunStatus> = new Set(['done', 'failed', 'cancelled']);

const idle = (reason: string): Action => ({ kind: 'idle', reason });

export function decide(s: RunSnapshot): Action {
  if (IDLE_STATUSES.has(s.status)) return idle(`the run is ${s.status}`);
  const step = PIPELINE[s.step];
  switch (step.kind) {
    case 'job':
      return decideJob(s, step.mayFail === true);
    case 'gate':
      return decideGate(s, step.gate);
    case 'effect':
      return s.otherActiveJobs > 0
        ? idle('other jobs of the run are still active')
        : { kind: 'effect', step: s.step, then: nextStep(s.step) };
    case 'children':
      return decideChildren(s.parts ?? []);
    case 'end':
      return { kind: 'finish', status: 'done' };
  }
}

function decideJob(s: RunSnapshot, mayFail: boolean): Action {
  if (!s.stepJob) {
    if (s.part && s.step === 'script' && !s.part.previousReady) {
      return idle(`part ${s.part.index} waits for part ${s.part.index - 1}'s scenes approval`);
    }
    if (s.otherActiveJobs > 0) return idle('other jobs of the run are still active');
    return { kind: 'enqueue', step: s.step };
  }
  switch (s.stepJob.status) {
    case 'queued':
    case 'running':
      return idle(`${s.step} is ${s.stepJob.status}`);
    case 'done':
      return { kind: 'advance', to: nextStep(s.step) };
    case 'failed':
      return mayFail ? { kind: 'advance', to: nextStep(s.step) } : idle(`${s.step} failed`);
    case 'cancelled':
      return idle(`${s.step} was cancelled`);
  }
}

function decideGate(s: RunSnapshot, gate: GateId): Action {
  if (!s.gate) return { kind: 'open_gate', gate };
  switch (s.gate.status) {
    case 'approved':
      return s.gate.current
        ? { kind: 'advance', to: nextStep(s.step) }
        : { kind: 'carry_gate', gate };
    case 'rejected':
      return { kind: 'finish', status: 'cancelled' };
    case 'pending':
      if (!s.gate.current) return { kind: 'open_gate', gate };
      if (s.autoApprove[gate] && !s.held && s.blocking.length === 0) {
        return { kind: 'approve_gate', gate };
      }
      return s.status === 'awaiting_review'
        ? idle(`gate ${gate} awaits review`)
        : { kind: 'await_review', gate };
  }
}

function decideChildren(parts: readonly RunStatus[]): Action {
  if (parts.length === 0) return { kind: 'finish', status: 'failed' };
  if (!parts.every((p) => TERMINAL.has(p))) return idle('the parts are still running');
  return { kind: 'finish', status: parts.every((p) => p === 'done') ? 'done' : 'failed' };
}

// --- Regenerate --------------------------------------------------------------------------------

export type { RegenerateTarget };

const TARGETS_AT: Readonly<Record<GateId, readonly RegenerateTarget[]>> = {
  research: ['researcher', 'source'],
  beat_sheet: ['director'],
  scenes: ['beat', 'scriptwriter', 'generator'],
  draft: ['beat', 'scriptwriter', 'generator'],
};

const RERUN_FROM: Readonly<Record<RegenerateTarget, PipelineStepId>> = {
  researcher: 'research',
  source: 'ingest',
  director: 'direct',
  beat: 'repair',
  scriptwriter: 'script',
  generator: 'generate',
};

export interface RegenerateRoute {
  /** The step the run goes back to; everything after it runs again. */
  readonly from: PipelineStepId;
  /**
   * Gates reviewed again: the deciding gate and every later one. An earlier gate the rerun
   * passes stays approved (its subject is updated): a beat regenerated at the draft gate does
   * not reopen the scenes gate.
   */
  readonly reopen: readonly GateId[];
}

export class RegenerateNotAllowedError extends Error {
  override readonly name = 'RegenerateNotAllowedError';
}

/** Where a regenerate at `gate` of `target` sends the run (pure). */
export function regenerateRoute(gate: GateId, target: RegenerateTarget): RegenerateRoute {
  if (!TARGETS_AT[gate].includes(target)) {
    throw new RegenerateNotAllowedError(
      `Gate ${gate} cannot regenerate ${target}; it can regenerate ${TARGETS_AT[gate].join(', ')}.`,
    );
  }
  const from = RERUN_FROM[target];
  const reopen = GATE_IDS.filter((g) => !isAfter(GATE_STEPS[gate], GATE_STEPS[g]));
  if (!isAfter(GATE_STEPS[gate], from)) {
    throw new RegenerateNotAllowedError(`${target} does not run before gate ${gate}.`);
  }
  return { from, reopen };
}
