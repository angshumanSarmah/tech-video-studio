import {
  citableChunks,
  researchGateFindings,
  researchNotesProblems,
  SourceChunksFileSchema,
  topicMatchMessage,
  type DirectorInput,
  type ResearchInput,
  type ResearchSourceStat,
  type SpecError,
} from '@explainer-studio/shared';
import { planCheckDeps, planIssues, splitPlanIssues } from '../checks/plan.ts';
import { readDataJson, sourceChunksPath } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import type { Run } from '../db/repositories/runs.ts';
import { getSeries, seriesChannelHandle } from '../db/repositories/series.ts';
import {
  getSource,
  listTopicSources,
  sourceOrigin,
  type Source,
} from '../db/repositories/sources.ts';
import { OrchestratorStateError } from '../errors.ts';
import { latestDirection } from './direction.ts';
import { latestResearch, researchOfStep, type RunResearch } from './research-notes.ts';

/**
 * The checks of gates 1 and 2 (P1C.9 step 9), shared by the orchestrator (what blocks
 * auto-approve) and the gate view (what it shows). Research: the notes' own checks, then thin
 * research and sources that disagree, as the run's `research.disagreementBlocks` says
 * (`researchGateFindings`). Beat sheet: the Director's checks
 * (`planIssues`), the advisory ones as warnings with the earlier topics close to this one. An
 * agent's answer passes its own checks to finish its step, so these block mostly a user's
 * edit, and research that is thin or disputed.
 */

export interface ResearchReview {
  readonly research: RunResearch;
  readonly sources: ResearchSourceStat[];
  /** The notes' check findings (citations, numbers), then thin research and disagreements. */
  readonly blocking: SpecError[];
  /** Never blocking: disagreements the run's rule leaves advisory, then many sources. */
  readonly warnings: SpecError[];
  /** The notes' check findings alone (the gate's `checks`). */
  readonly checks: SpecError[];
}

export function researchReview(
  db: Executor,
  dataDir: string,
  run: Run,
): ResearchReview | undefined {
  const research = latestResearch(db, dataDir, run.id);
  if (!research) return undefined;
  const sources = researchSourceStats(db, dataDir, run, research.input);
  const checks = researchNotesProblems(research.notes, citableChunks(research.input));
  const findings = researchGateFindings(research.notes, sources, run.resolvedSettings.research);
  return {
    research,
    sources,
    checks,
    blocking: [...checks, ...findings.blocking],
    warnings: findings.warnings,
  };
}

/**
 * Each source the research step read (its pinned version's length and chunks, and how many
 * chunks were sent), then each of the topic's sources that failed, with why.
 */
export function researchSourceStats(
  db: Executor,
  dataDir: string,
  run: Run,
  input: ResearchInput,
): ResearchSourceStat[] {
  const read = input.sources.map((s): ResearchSourceStat => {
    const source = getSource(db, s.sourceId);
    const file = SourceChunksFileSchema.parse(
      readDataJson(dataDir, sourceChunksPath(run.topicId, s.sourceId, s.contentHash)),
    );
    return {
      ...describe(source, s.sourceId, s.origin),
      title: s.title,
      read: {
        chars: file.chunks.at(-1)?.end ?? 0,
        chunks: file.chunks.length,
        sentChunks: s.chunks.length,
      },
    };
  });
  const readIds = new Set(input.sources.map((s) => s.sourceId));
  const failed = listTopicSources(db, run.topicId)
    .filter((s) => s.status === 'failed' && !readIds.has(s.id))
    .map((s): ResearchSourceStat => ({ ...describe(s, s.id, sourceOrigin(s)), read: null }));
  return [...read, ...failed];
}

function describe(source: Source | undefined, sourceId: number, origin: string) {
  return {
    sourceId,
    kind: source?.kind ?? 'url',
    origin: source ? sourceOrigin(source) : origin,
    title: source?.title ?? null,
    status: source?.status ?? 'extracted',
    error: source?.error ?? null,
    errorCode: source?.errorCode ?? null,
  } as const;
}

export interface BeatSheetReview {
  readonly direction: NonNullable<ReturnType<typeof latestDirection>>;
  /** Every plan issue. */
  readonly issues: SpecError[];
  /** The plan issues that keep the gate from approving itself. */
  readonly blocking: SpecError[];
  /**
   * Never blocking (P1C.10): advisory plan issues (`hook_repeated`), then earlier topics close
   * to this run's, as the Director read them (`topic_similar`).
   */
  readonly warnings: SpecError[];
}

export function beatSheetReview(
  db: Executor,
  dataDir: string,
  run: Run,
): BeatSheetReview | undefined {
  const direction = latestDirection(db, dataDir, run.id);
  if (!direction) return undefined;
  const issues = planIssues(direction.plan, planDeps(db, dataDir, run, direction.input));
  const { blocking, warnings } = splitPlanIssues(issues);
  return {
    direction,
    issues,
    blocking,
    warnings: [...warnings, ...similarTopicWarnings(direction.input)],
  };
}

/** `topic_similar`: one per earlier topic the Director's memory found close to this one. */
function similarTopicWarnings(input: DirectorInput): SpecError[] {
  return (input.memory.similarTopics ?? []).map((match) => ({
    path: '$.meta.title',
    code: 'topic_similar',
    message: topicMatchMessage(match),
  }));
}

/** The beat-sheet checks' context, from the Director step's input (as the Director had it). */
export function planDeps(
  db: Executor,
  dataDir: string,
  run: Run,
  input: NonNullable<ReturnType<typeof latestDirection>>['input'],
) {
  const research = researchOfStep(db, dataDir, input.researchStepId);
  if (!research) {
    throw new OrchestratorStateError(`Research step ${input.researchStepId} is not finished.`);
  }
  const series = getSeries(db, run.seriesId);
  if (!series) throw new OrchestratorStateError(`Run ${run.id} has no series.`);
  return planCheckDeps({
    runId: run.id,
    input,
    notes: research.notes,
    sources: research.input.sources,
    video: run.resolvedSettings.video,
    series,
    channelHandle: seriesChannelHandle(db, series.id),
  });
}
