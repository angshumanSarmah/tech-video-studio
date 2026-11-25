import {
  ScriptwriterInputSchema,
  type DirectorPart,
  type GateBadge,
  type PartRef,
  type VideoSpec,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { getGate } from '../db/repositories/gates.ts';
import { doneBeatSteps, latestDoneStep } from '../db/repositories/run-steps.ts';
import { listPartRuns, type Run } from '../db/repositories/runs.ts';
import {
  getLatestSpecVersion,
  getSpecVersion,
  type SpecVersion,
} from '../db/repositories/spec-versions.ts';
import { latestDirection } from './direction.ts';

/**
 * A part run's place in its multi-part video (P1C.9 step 8), for the agents that write it: its
 * number of the count, its title and main idea from the parent's parts plan, the part before it
 * (its approved narration, for the recap) and the part after it (whose question its cliffhanger
 * names). Part n+1's script waits for part n's scenes approval (P1C.9 step 9); a later change to
 * part n's narration marks part n+1's recap stale (`staleRecapBadge`).
 */

/** A spec's narration, per beat. */
type Narration = readonly { readonly beatId: string; readonly narration: string }[];

export interface RunPart extends PartRef {
  readonly title: string;
  readonly mainIdea: string;
  /** The part before this one (none for part 1): its approved narration, per beat. */
  readonly previous: {
    readonly index: number;
    readonly title: string;
    readonly runId: number;
    readonly specVersionId: number;
    readonly narration: Narration;
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
 * spec (part n+1's script waits for part n's scenes approval): its absence is an error.
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
  const version = before && recapSourceVersion(db, before);
  if (!before || !version) {
    throw new Error(`Part ${index} has no spec yet: part ${run.partIndex} recaps it.`);
  }
  return {
    index,
    title: entry?.title ?? `Part ${index}`,
    runId: before.id,
    specVersionId: version.id,
    narration: narrationOf(dataDir, version),
  };
}

/**
 * The version of a part that the next part's recap reads: the one its scenes gate approved
 * (carried approvals included), else its latest (the gate reopened by a regenerate).
 */
export function recapSourceVersion(db: Executor, part: Run): SpecVersion | undefined {
  const gate = getGate(db, part.id, 'scenes');
  const approved =
    gate?.status === 'approved' && gate.specVersionId !== null
      ? getSpecVersion(db, gate.specVersionId)
      : undefined;
  return approved ?? getLatestSpecVersion(db, part.id);
}

function narrationOf(dataDir: string, version: SpecVersion): Narration {
  const spec = readDataJson(dataDir, version.jsonPath) as VideoSpec;
  return (spec.script ?? []).map(({ beatId, narration }) => ({ beatId, narration }));
}

/**
 * Part n+1's recap is stale when part n's narration (`recapSourceVersion`) differs from the
 * version the recap was last written from: the script step's, or a later revision of the recap
 * beat's (a repair or a regenerate records the version it read). An advisory badge on the recap
 * beat (the `recap_opening` beat, else the first); the fix is to regenerate that beat's narration.
 */
export function staleRecapBadge(
  db: Executor,
  dataDir: string,
  run: Run,
  spec: VideoSpec,
): GateBadge | undefined {
  if (run.parentRunId === null || run.partIndex === null || run.partIndex < 2) return undefined;
  const before = listPartRuns(db, run.parentRunId).find((p) => p.partIndex === run.partIndex! - 1);
  const now = before && recapSourceVersion(db, before);
  const beatId = recapBeatId(spec);
  if (!now || beatId === undefined) return undefined;
  const basisId = recapBasis(db, dataDir, run.id, beatId);
  if (basisId === undefined || basisId === now.id) return undefined;
  const basis = getSpecVersion(db, basisId);
  if (!basis) return undefined;
  const changed = changedBeats(narrationOf(dataDir, basis), narrationOf(dataDir, now));
  if (changed.length === 0) return undefined;
  const n = run.partIndex - 1;
  return {
    beatId,
    source: 'code',
    code: 'recap_stale',
    severity: 'advisory',
    owner: 'scriptwriter',
    message:
      `Part ${n}'s narration changed after this recap was written (${changed.join(', ')}): the ` +
      `recap may be stale. Regenerate beat ${beatId} (narration) so it recaps part ${n} as it is now.`,
    needsPlanChange: false,
  };
}

function recapBeatId(spec: VideoSpec): string | undefined {
  return spec.story.beats.find((b) => b.device === 'recap_opening')?.id ?? spec.story.beats[0]?.id;
}

const RecapRevisionSchema = z.object({
  kind: z.literal('script'),
  input: z.object({ previousSpecVersionId: z.number().int().positive().optional() }),
});

/** The version of the part before that the recap beat was last written from. */
function recapBasis(
  db: Executor,
  dataDir: string,
  runId: number,
  beatId: string,
): number | undefined {
  const revision = doneBeatSteps(db, runId, 'repair', beatId)
    .map((step) => ({ step, record: step.inputPath && readDataJson(dataDir, step.inputPath) }))
    .map(({ step, record }) => ({ step, parsed: RecapRevisionSchema.safeParse(record) }))
    .find(({ parsed }) => parsed.success && parsed.data.input.previousSpecVersionId !== undefined);
  const script = latestDoneStep(db, runId, 'script');
  if (revision?.parsed.success && (!script || revision.step.id > script.id)) {
    return revision.parsed.data.input.previousSpecVersionId;
  }
  if (!script?.inputPath) return undefined;
  return ScriptwriterInputSchema.parse(readDataJson(dataDir, script.inputPath)).part
    ?.previousSpecVersionId;
}

function changedBeats(before: Narration, after: Narration): string[] {
  const text = (list: Narration) => new Map(list.map((b) => [b.beatId, b.narration]));
  const [a, b] = [text(before), text(after)];
  return [...new Set([...a.keys(), ...b.keys()])].filter((id) => a.get(id) !== b.get(id));
}

function nextPart(entry: DirectorPart | undefined): RunPart['next'] {
  return entry ? { index: entry.part, title: entry.title, mainIdea: entry.mainIdea } : null;
}
