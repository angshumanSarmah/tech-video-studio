import type { DirectorPart, PartRef, VideoSpec } from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { listPartRuns, type Run } from '../db/repositories/runs.ts';
import { getLatestSpecVersion } from '../db/repositories/spec-versions.ts';
import { latestDirection } from './direction.ts';

/**
 * A part run's place in its multi-part video (P1C.9 step 8), for the agents that write it: its
 * number of the count, its title and main idea from the parent's parts plan, the part before it
 * (its narration as it stands now, for the recap) and the part after it (whose question its
 * cliffhanger names).
 */

export interface RunPart extends PartRef {
  readonly title: string;
  readonly mainIdea: string;
  /** The part before this one (none for part 1): its latest spec's narration, per beat. */
  readonly previous: {
    readonly index: number;
    readonly title: string;
    readonly runId: number;
    readonly specVersionId: number;
    readonly narration: readonly { readonly beatId: string; readonly narration: string }[];
  } | null;
  /** The part after this one (none for the last part). */
  readonly next: {
    readonly index: number;
    readonly title: string;
    readonly mainIdea: string;
  } | null;
}

/** `meta.part` of a part run's specs; undefined for a single video or a parent. */
export function partRefOf(run: Run): PartRef | undefined {
  if (run.partIndex === null || run.partCount === null) return undefined;
  return { index: run.partIndex, count: run.partCount };
}

/**
 * The run's part context, undefined for a single video. The part before must already have a
 * spec (part n+1's script waits until part n is past `spec`): its absence is an error.
 */
export function runPart(db: Executor, dataDir: string, run: Run): RunPart | undefined {
  const ref = partRefOf(run);
  if (!ref || run.parentRunId === null) return undefined;
  const parts = latestDirection(db, dataDir, run.parentRunId)?.plan.parts ?? [];
  const entry = (index: number) => parts.find((p) => p.part === index);
  const own = entry(ref.index);
  if (!own) throw new Error(`Run ${run.parentRunId}'s plan has no part ${ref.index}.`);
  return {
    ...ref,
    title: own.title,
    mainIdea: own.mainIdea,
    previous: ref.index > 1 ? previousPart(db, dataDir, run, entry(ref.index - 1)) : null,
    next: nextPart(entry(ref.index + 1)),
  };
}

function previousPart(
  db: Executor,
  dataDir: string,
  run: Run,
  entry: DirectorPart | undefined,
): RunPart['previous'] {
  const index = run.partIndex! - 1;
  const before = listPartRuns(db, run.parentRunId!).find((p) => p.partIndex === index);
  const version = before && getLatestSpecVersion(db, before.id);
  if (!before || !version) {
    throw new Error(`Part ${index} has no spec yet: part ${run.partIndex} recaps it.`);
  }
  const spec = readDataJson(dataDir, version.jsonPath) as VideoSpec;
  return {
    index,
    title: entry?.title ?? `Part ${index}`,
    runId: before.id,
    specVersionId: version.id,
    narration: (spec.script ?? []).map(({ beatId, narration }) => ({ beatId, narration })),
  };
}

function nextPart(entry: DirectorPart | undefined): RunPart['next'] {
  return entry ? { index: entry.part, title: entry.title, mainIdea: entry.mainIdea } : null;
}
