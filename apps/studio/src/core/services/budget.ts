import type { Executor } from '../db/client.ts';
import { runCostUsd } from '../db/repositories/llm-calls.ts';
import { getRun, listPartRuns } from '../db/repositories/runs.ts';

/**
 * The cost cap of a video (P1C.9 steps 7-8): a single video's run, or a multi-part video's
 * parent and all its parts, spends against one cap, the parent's `budget.maxRunUsd`. Parts copy
 * the parent's snapshot when they are created, but only the parent's cap counts, so raising it on
 * the parent covers every part.
 */

export interface VideoBudget {
  /** The run whose cap it is: the run itself, or a part's parent. */
  readonly capRunId: number;
  /** What the video has spent: the run's calls, or the parent's and every part's. */
  readonly spentUsd: number;
  readonly capUsd: number;
}

/** The budget of the video `runId` belongs to; undefined for an unknown run. */
export function videoBudget(db: Executor, runId: number): VideoBudget | undefined {
  const run = getRun(db, runId);
  if (!run) return undefined;
  const root = run.parentRunId === null ? run : getRun(db, run.parentRunId);
  if (!root) return undefined;
  return {
    capRunId: root.id,
    spentUsd: videoCostUsd(db, root.id),
    capUsd: root.resolvedSettings.budget.maxRunUsd,
  };
}

/** A run's spend plus its parts' (a single video has none). */
export function videoCostUsd(db: Executor, rootRunId: number): number {
  return listPartRuns(db, rootRunId).reduce(
    (sum, part) => sum + runCostUsd(db, part.id),
    runCostUsd(db, rootRunId),
  );
}
