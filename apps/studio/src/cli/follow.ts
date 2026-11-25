import type { GateId } from '@explainer-studio/shared';
import { listEventsSince, type StoredEvent } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { runCostUsd } from '#core/db/repositories/llm-calls.ts';
import { getRun, listPartRuns, type Run } from '#core/db/repositories/runs.ts';
import { PIPELINE } from '#core/orchestrator/pipeline.ts';
import type { CliContext } from './context.ts';
import { eventLine, progressLine } from './progress.ts';

/**
 * Follows a run (and, for a multi-part video, its parts) by reading the events table, which every
 * worker writes to, so it works the same whether this process runs the jobs or another one does.
 * Ends when a run waits at a gate, is paused, or the followed run is over.
 */

export type FollowEnd =
  | { readonly kind: 'gate'; readonly runId: number; readonly gate: GateId }
  | { readonly kind: 'paused'; readonly runId: number }
  | { readonly kind: 'interrupted'; readonly runId: number }
  | {
      readonly kind: 'finished';
      readonly runId: number;
      readonly status: 'done' | 'failed' | 'cancelled';
    };

const DEFAULT_POLL_MS = 250;
const PAGE = 500;

/**
 * `after`: print only events after this id (0: the run's whole history); `cursors` keeps where
 * each run's printing got to, across calls.
 */
export async function followRun(
  ctx: CliContext,
  rootId: number,
  cursors: Map<number, RunCursor>,
  after = 0,
): Promise<FollowEnd> {
  for (;;) {
    const runs = followed(ctx, rootId);
    for (const run of runs) printNew(ctx, run, cursors, after);
    const end = endOf(runs);
    if (end) return end;
    if (ctx.signal?.aborted) return { kind: 'interrupted', runId: rootId };
    await new Promise((resolve) => setTimeout(resolve, ctx.pollMs ?? DEFAULT_POLL_MS));
  }
}

function followed(ctx: CliContext, rootId: number): Run[] {
  const root = getRun(ctx.db, rootId);
  if (!root) throw new Error(`Run ${rootId} not found.`);
  return [root, ...listPartRuns(ctx.db, rootId)];
}

/** A part waiting at a gate first; then the root's own state. */
export function endOf(runs: readonly Run[]): FollowEnd | undefined {
  for (const run of runs) {
    const step = PIPELINE[run.pipelineStep];
    if (run.status === 'awaiting_review' && step.kind === 'gate') {
      return { kind: 'gate', runId: run.id, gate: step.gate };
    }
    if (run.status === 'paused') return { kind: 'paused', runId: run.id };
  }
  const root = runs[0]!;
  if (root.status === 'done' || root.status === 'failed' || root.status === 'cancelled') {
    return { kind: 'finished', runId: root.id, status: root.status };
  }
  return undefined;
}

export function runLabel(run: Run): string {
  return run.partIndex === null
    ? `run ${run.id}`
    : `run ${run.id} (part ${run.partIndex}/${run.partCount})`;
}

export type FollowCursors = Map<number, RunCursor>;

/** What the printing remembers per run: the last event, step and when each job started. */
interface RunCursor {
  after: number;
  step: string | null;
  readonly started: Map<number, Date>;
}

function printNew(ctx: CliContext, run: Run, cursors: Map<number, RunCursor>, after: number): void {
  const label = runLabel(run);
  const cursor = cursors.get(run.id) ?? { after, step: null, started: new Map() };
  cursors.set(run.id, cursor);
  for (;;) {
    const events = listEventsSince(ctx.db, { runId: run.id, afterId: cursor.after, limit: PAGE });
    for (const event of events) {
      cursor.after = event.id;
      const line = lineOf(ctx, event, label, cursor);
      if (line) ctx.io.out(line);
    }
    if (events.length < PAGE) return;
  }
}

function lineOf(ctx: CliContext, event: StoredEvent, label: string, cursor: RunCursor) {
  const job = event.jobId === null ? undefined : getJob(ctx.db, event.jobId);
  switch (event.type) {
    case 'progress': {
      const line = progressLine(event, label, job?.type ?? 'job');
      if (line) ctx.io.live(line);
      return null;
    }
    case 'run_status': {
      // One line per step entered: a step's queued, running and waiting events are one.
      const step = event.payload.step ?? null;
      if (step !== null && step === cursor.step && event.payload.status !== 'paused') return null;
      cursor.step = step ?? cursor.step;
      return eventLine(event, { label });
    }
    case 'job_status': {
      if (event.payload.status === 'running') {
        if (event.jobId !== null) cursor.started.set(event.jobId, event.createdAt);
        return null;
      }
      const started = event.jobId === null ? undefined : cursor.started.get(event.jobId);
      const seconds = started ? (event.createdAt.getTime() - started.getTime()) / 1000 : null;
      return eventLine(event, {
        label,
        job: { type: job?.type ?? 'job', seconds },
        costUsd: runCostUsd(ctx.db, event.runId ?? 0, event.createdAt),
      });
    }
    default:
      return eventLine(event, { label });
  }
}
