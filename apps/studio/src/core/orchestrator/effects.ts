import {
  assembleScriptedSpec,
  partPlan,
  validateVideoSpec,
  type PipelineStepId,
  type VideoSpec,
} from '@explainer-studio/shared';
import { directPlanPath, readDataJson, writeDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { recordMissingPrimitives } from '../db/repositories/backlog.ts';
import { finishRunStep, setRunStepInput, startRunStep } from '../db/repositories/run-steps.ts';
import { createRun, type Run } from '../db/repositories/runs.ts';
import { getSeries } from '../db/repositories/series.ts';
import { getLatestSpecVersion } from '../db/repositories/spec-versions.ts';
import { latestDirection, type RunDirection } from '../services/direction.ts';
import { latestScript } from '../services/script.ts';
import { saveSpecVersionIn } from '../services/spec-versions.ts';
import { OrchestratorStateError } from './snapshot.ts';

/**
 * The transitions the orchestrator makes between steps (P1C.9), in the transaction that advances
 * the run. Each returns the step the run goes to. Idempotent: a rerun saves nothing new.
 */

export interface EffectContext {
  readonly tx: Executor;
  readonly dataDir: string;
  readonly run: Run;
  /** Runs a part's orchestrator once it exists (it starts at `script`). */
  readonly advancePart: (runId: number) => void;
}

export type Effect = (ctx: EffectContext, then: PipelineStepId) => PipelineStepId;

export const EFFECTS: Partial<Record<PipelineStepId, Effect>> = {
  split,
  spec,
  board_backlog: boardBacklog,
};

function requireDirection(ctx: EffectContext): RunDirection {
  const direction = latestDirection(ctx.tx, ctx.dataDir, ctx.run.id);
  if (!direction) throw new OrchestratorStateError(`Run ${ctx.run.id} has no finished plan.`);
  return direction;
}

/**
 * After the beat-sheet gate: the plan's missing-primitive requests go to the backlog; a plan with
 * parts becomes one child run per part (the parent waits at `children`), otherwise the run goes
 * on to its script.
 */
function split(ctx: EffectContext, then: PipelineStepId): PipelineStepId {
  const direction = requireDirection(ctx);
  const { plan } = direction;
  recordMissingPrimitives(ctx.tx, ctx.run.id, plan.story.missingPrimitiveRequests ?? []);
  if (!plan.parts) return then;
  for (const part of plan.parts) {
    const child = createPart(ctx, direction, part.part, plan.parts.length);
    ctx.advancePart(child.id);
  }
  return 'children';
}

/**
 * A part as its own run: the parent's settings and snapshot, and a finished `direct` step whose
 * plan is the part's (`partPlan`) and whose input is the parent's, so the part reads the same
 * research step. It starts at `script`.
 */
function createPart(ctx: EffectContext, direction: RunDirection, part: number, count: number) {
  const { tx, dataDir, run } = ctx;
  const child = createRun(tx, {
    topicId: run.topicId,
    seriesId: run.seriesId,
    settings: run.settings,
    app: run.resolvedSettings,
    snapshot: run.resolvedSettings,
    part: { parentRunId: run.id, index: part, count },
    pipelineStep: 'script',
  });
  const step = startRunStep(tx, { runId: child.id, stage: 'direct' });
  setRunStepInput(tx, step.id, direction.step.inputPath!);
  const plan = partPlan(direction.plan, part);
  finishRunStep(tx, step.id, writeDataJson(dataDir, directPlanPath(child.id, step.id), plan));
  appendEvent(tx, {
    runId: child.id,
    type: 'run_status',
    payload: { status: child.status, step: 'script' },
  });
  return child;
}

/** After the script: the plan and script assembled into the run's next spec version. */
function spec(ctx: EffectContext, then: PipelineStepId): PipelineStepId {
  const { tx, dataDir, run } = ctx;
  const direction = requireDirection(ctx);
  const script = latestScript(tx, dataDir, run.id);
  if (!script) throw new OrchestratorStateError(`Run ${run.id} has no finished script.`);
  const series = getSeries(tx, run.seriesId);
  if (!series) throw new OrchestratorStateError(`Run ${run.id} has no series.`);
  const assembled = validateVideoSpec(
    assembleScriptedSpec(direction.plan, script.output.script, {
      id: `run-${run.id}`,
      series: series.tag,
      seriesNumber: seriesNumber(direction, run),
      ...(run.settings.format ? { formatOverride: run.settings.format } : {}),
    }),
  );
  if (!assembled.ok) {
    const issues = assembled.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new OrchestratorStateError(`The plan and script do not make a valid spec: ${issues}`);
  }
  saveSpecVersionIn(tx, dataDir, { runId: run.id, spec: assembled.spec, createdBy: 'agent' });
  return then;
}

/** The series number the Director was given, plus the part's offset. */
function seriesNumber(direction: RunDirection, run: Run): number {
  return direction.input.series.nextNumber + (run.partIndex ?? 1) - 1;
}

/** After the boards: the Generator's missing-primitive requests go to the backlog. */
function boardBacklog(ctx: EffectContext, then: PipelineStepId): PipelineStepId {
  const latest = getLatestSpecVersion(ctx.tx, ctx.run.id);
  if (latest) {
    const spec = readDataJson(ctx.dataDir, latest.jsonPath) as VideoSpec;
    recordMissingPrimitives(ctx.tx, ctx.run.id, spec.story.missingPrimitiveRequests ?? []);
  }
  return then;
}
