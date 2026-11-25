import type { GateId } from '@explainer-studio/shared';
import type { Executor } from '../db/client.ts';
import { getGate, type GateSubject } from '../db/repositories/gates.ts';
import { getJob, listRunJobs } from '../db/repositories/jobs.ts';
import { latestDoneStep } from '../db/repositories/run-steps.ts';
import { getRun, listPartRuns, type Run } from '../db/repositories/runs.ts';
import { NotFoundError, OrchestratorStateError } from '../errors.ts';
import { latestCuration } from '../services/curation.ts';
import { finalBlockers } from '../services/final-check.ts';
import { beatSheetReview, researchReview } from '../services/gate-checks.ts';
import type { RunSnapshot } from './decide.ts';
import { PIPELINE } from './pipeline.ts';

/**
 * Reads what `decide` needs from a run's rows (and, at a gate, the files that say what it
 * reviews and what blocks it). Read-only.
 */

export { OrchestratorStateError };

export function requireRun(db: Executor, runId: number): Run {
  const run = getRun(db, runId);
  if (!run) throw new NotFoundError('Run', runId);
  return run;
}

export function readRunSnapshot(db: Executor, dataDir: string, runId: number): RunSnapshot {
  const run = requireRun(db, runId);
  const step = PIPELINE[run.pipelineStep];
  const stepJob = run.stepJobId === null ? undefined : getJob(db, run.stepJobId);
  const active = listRunJobs(db, runId).filter(
    (j) => (j.status === 'queued' || j.status === 'running') && j.id !== run.stepJobId,
  );
  const gate = step.kind === 'gate' ? gateState(db, dataDir, run, step.gate) : undefined;
  return {
    status: run.status,
    step: run.pipelineStep,
    stepJob: stepJob ? { status: stepJob.status } : null,
    otherActiveJobs: active.length,
    gate: gate?.row ?? null,
    blocking: gate?.blocking ?? [],
    autoApprove: run.settings.autoApprove,
    held: step.kind === 'gate' && run.holdGate === step.gate,
    part: partState(db, run),
    parts: step.kind === 'children' ? listPartRuns(db, runId).map((p) => p.status) : null,
  };
}

function gateState(db: Executor, dataDir: string, run: Run, gate: GateId) {
  const subject = gateSubject(db, dataDir, run, gate);
  const row = getGate(db, run.id, gate);
  return {
    row: row
      ? {
          status: row.status,
          current:
            row.specVersionId === (subject.specVersionId ?? null) &&
            row.subjectStepId === (subject.subjectStepId ?? null),
        }
      : null,
    blocking: gateBlocking(db, dataDir, run, gate, subject),
  };
}

/** What the gate reviews now: the newest research or plan, the curated version, the draft's. */
export function gateSubject(db: Executor, dataDir: string, run: Run, gate: GateId): GateSubject {
  switch (gate) {
    case 'research':
      return { subjectStepId: requireStep(db, run, 'research') };
    case 'beat_sheet':
      return { subjectStepId: requireStep(db, run, 'direct') };
    case 'scenes': {
      const curation = latestCuration(db, dataDir, run.id);
      if (!curation) throw new OrchestratorStateError(`Run ${run.id} has no curation to review.`);
      return { specVersionId: curation.report.final.specVersionId };
    }
    case 'draft': {
      const scenes = getGate(db, run.id, 'scenes')?.specVersionId;
      if (!scenes) throw new OrchestratorStateError(`Run ${run.id} has no approved scenes.`);
      return { specVersionId: scenes };
    }
  }
}

function requireStep(db: Executor, run: Run, stage: 'research' | 'direct'): number {
  const step = latestDoneStep(db, run.id, stage);
  if (!step) throw new OrchestratorStateError(`Run ${run.id} has no finished ${stage} step.`);
  return step.id;
}

/**
 * Why a gate cannot be auto-approved (P1C.9 step 9). Research: the notes' check findings, thin
 * research and sources that disagree. Beat sheet: the Director's checks (an edited plan's
 * findings), less the advisory ones. Scenes: the Curator's blocking issues. Draft: what would stop the final.
 */
export function gateBlocking(
  db: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  subject: GateSubject,
): string[] {
  switch (gate) {
    case 'research':
      return (researchReview(db, dataDir, run)?.blocking ?? []).map(issueLine);
    case 'beat_sheet':
      return (beatSheetReview(db, dataDir, run)?.blocking ?? []).map(issueLine);
    case 'scenes': {
      const report = latestCuration(db, dataDir, run.id)?.report;
      return (report?.badges ?? [])
        .filter((b) => b.severity === 'blocking')
        .map((b) => `${b.beatId ?? 'video'}: ${b.code}`);
    }
    case 'draft':
      return finalBlockers(dataDir, run.id, subject.specVersionId!);
  }
}

const issueLine = (issue: { path: string; code: string; message: string }): string =>
  `${issue.code} at ${issue.path}: ${issue.message}`;

/**
 * A part's number, and whether the part before it is ready for this part's script: done, or its
 * scenes gate approved, so a recap always reads narration a person (or auto-approve) passed.
 */
function partState(db: Executor, run: Run): RunSnapshot['part'] {
  if (run.parentRunId === null || run.partIndex === null) return null;
  if (run.partIndex === 1) return { index: 1, previousReady: true };
  const previous = listPartRuns(db, run.parentRunId).find(
    (p) => p.partIndex === run.partIndex! - 1,
  );
  const previousReady =
    previous !== undefined &&
    (previous.status === 'done' || getGate(db, previous.id, 'scenes')?.status === 'approved');
  return { index: run.partIndex, previousReady };
}
