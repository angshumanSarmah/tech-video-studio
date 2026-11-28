import { missingAssetBadges } from '../assets/missing-uses.ts';
import { existsSync } from 'node:fs';
import {
  VideoSpecShapeSchema,
  type DecidedBy,
  type GateBadge,
  type GateContent,
  type GateId,
  type GateIssue,
  type GateStatus,
  type GateSubjectDto,
  type ModelRole,
  type RegenerateOutcome,
  type VideoSpec,
} from '@explainer-studio/shared';
import {
  beatStillPath,
  readDataJson,
  resolveDataPath,
  runDraftPath,
  stillsManifestPath,
} from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { getGate, type GateSubject } from '../db/repositories/gates.ts';
import { runCostByRole, runCostUsd } from '../db/repositories/llm-calls.ts';
import type { Run } from '../db/repositories/runs.ts';
import { getSpecVersion } from '../db/repositories/spec-versions.ts';
import { GATE_STEPS } from '../orchestrator/pipeline.ts';
import {
  gateBlocking,
  gateSubject,
  OrchestratorStateError,
  requireRun,
} from '../orchestrator/snapshot.ts';
import { DraftManifestSchema, manifestPathFor, StillsManifestSchema } from '../render-manifests.ts';
import { latestCuration } from './curation.ts';
import { beatSheetReview, researchReview } from './gate-checks.ts';
import { latestRegenerateOutcome } from './regenerate-outcome.ts';
import { staleRecapBadge } from './parts.ts';

/**
 * A gate's review payload (P1C.9 step 4): what it reviews and its checks, what blocks it, the
 * previews of its version and the run's cost so far. Read-only; the decisions are in
 * `gate-decisions.ts`.
 */

export interface GateView {
  readonly runId: number;
  readonly gate: GateId;
  readonly status: GateStatus | null;
  readonly decidedBy: DecidedBy | null;
  readonly carriedFrom: GateId | null;
  readonly notes: string | null;
  readonly decidedAt: Date | null;
  readonly waiting: boolean;
  readonly subject: GateSubjectDto | null;
  readonly content: GateContent | null;
  readonly checks: GateIssue[];
  readonly badges: GateBadge[];
  readonly blocking: string[];
  readonly warnings: GateIssue[];
  readonly regenerated: RegenerateOutcome | null;
  readonly stills: { beatId: string; path: string }[];
  readonly draftPath: string | null;
  readonly cost: RunCost;
}

export interface RunCost {
  readonly totalUsd: number;
  readonly byRole: { role: ModelRole; costUsd: number; calls: number }[];
}

/** The run stops at this gate for a decision. */
export const waitsAt = (run: Run, gate: GateId): boolean =>
  run.status === 'awaiting_review' && run.pipelineStep === GATE_STEPS[gate];

export function readGate(db: Executor, dataDir: string, runId: number, gate: GateId): GateView {
  const run = requireRun(db, runId);
  const row = getGate(db, runId, gate);
  const subject = currentSubject(db, dataDir, run, gate);
  const review = subject ? reviewOf(db, dataDir, run, gate, subject) : undefined;
  return {
    runId,
    gate,
    status: row?.status ?? null,
    decidedBy: row?.decidedBy ?? null,
    carriedFrom: row?.carriedFrom ?? null,
    notes: row?.notes ?? null,
    decidedAt: row?.decidedAt ?? null,
    waiting: waitsAt(run, gate),
    subject: subject ? subjectDto(db, subject) : null,
    content: review?.content ?? null,
    checks: review?.checks ?? [],
    badges: review?.badges ?? [],
    blocking: subject ? gateBlocking(db, dataDir, run, gate, subject) : [],
    warnings: review?.warnings ?? [],
    regenerated: latestRegenerateOutcome(db, dataDir, run.id, gate),
    stills: subject?.specVersionId ? stillsOf(dataDir, run.id, subject.specVersionId) : [],
    draftPath: subject?.specVersionId ? draftOf(dataDir, run.id, subject.specVersionId) : null,
    cost: runCost(db, run.id),
  };
}

/** What the gate reviews now; undefined before the run has produced it. */
export function currentSubject(
  db: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
): GateSubject | undefined {
  try {
    return gateSubject(db, dataDir, run, gate);
  } catch (error) {
    if (error instanceof OrchestratorStateError) return undefined;
    throw error;
  }
}

/** The id a decision names for this subject (`subjectId`). */
export const subjectId = (subject: GateSubject): number =>
  subject.specVersionId ?? subject.subjectStepId;

export function subjectDto(db: Executor, subject: GateSubject): GateSubjectDto {
  if (subject.subjectStepId !== undefined) return { kind: 'step', id: subject.subjectStepId };
  const version = getSpecVersion(db, subject.specVersionId);
  if (!version) throw new OrchestratorStateError(`Spec version ${subject.specVersionId} is gone.`);
  return { kind: 'spec_version', id: version.id, version: version.version };
}

export function runCost(db: Executor, runId: number): RunCost {
  return {
    totalUsd: runCostUsd(db, runId),
    byRole: runCostByRole(db, runId).map((r) => ({ ...r, role: r.role as ModelRole })),
  };
}

interface Review {
  readonly content: GateContent;
  readonly checks: GateIssue[];
  readonly badges: GateBadge[];
  readonly warnings: GateIssue[];
}

function reviewOf(
  db: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  subject: GateSubject,
): Review | undefined {
  switch (gate) {
    case 'research':
      return researchGateReview(db, dataDir, run);
    case 'beat_sheet':
      return beatSheetGateReview(db, dataDir, run);
    case 'scenes':
    case 'draft':
      return specReview(db, dataDir, run, gate, subject.specVersionId!);
  }
}

function researchGateReview(db: Executor, dataDir: string, run: Run): Review | undefined {
  const review = researchReview(db, dataDir, run);
  if (!review) return undefined;
  return {
    content: { gate: 'research', notes: review.research.notes, sources: review.sources },
    checks: review.checks.map(plainIssue),
    badges: [],
    warnings: review.warnings.map(plainIssue),
  };
}

function beatSheetGateReview(db: Executor, dataDir: string, run: Run): Review | undefined {
  const review = beatSheetReview(db, dataDir, run);
  if (!review) return undefined;
  return {
    content: { gate: 'beat_sheet', plan: review.direction.plan },
    checks: review.blocking.map(plainIssue),
    badges: [],
    warnings: review.warnings.map(plainIssue),
  };
}

/** Scenes and draft: the spec, and the Curator's findings when it reviewed this very version. */
function specReview(
  db: Executor,
  dataDir: string,
  run: Run,
  gate: 'scenes' | 'draft',
  specVersionId: number,
): Review | undefined {
  const spec = readSpecVersion(db, dataDir, specVersionId);
  if (!spec) return undefined;
  const report = latestCuration(db, dataDir, run.id)?.report;
  const curated = report?.final.specVersionId === specVersionId ? report : undefined;
  const stale = staleRecapBadge(db, dataDir, run, spec);
  // Missing assets are read live (an approved draft clears them at once), not from the report.
  const live = (code: string) => code !== 'unknown_asset';
  return {
    content: { gate, spec },
    checks: (curated?.codeIssues ?? []).filter((i) => live(i.code)).map(plainIssue),
    badges: [
      ...(curated?.badges ?? []).filter((b) => live(b.code)),
      ...missingAssetBadges(db, run.id, spec),
      ...(stale ? [stale] : []),
    ],
    warnings: [],
  };
}

export function readSpecVersion(
  db: Executor,
  dataDir: string,
  specVersionId: number,
): VideoSpec | undefined {
  const version = getSpecVersion(db, specVersionId);
  return version && VideoSpecShapeSchema.parse(readDataJson(dataDir, version.jsonPath));
}

const plainIssue = (issue: { path: string; code: string; message: string }): GateIssue => ({
  path: issue.path,
  code: issue.code,
  message: issue.message,
});

/** The stills, when the last stills render was of this version. */
function stillsOf(dataDir: string, runId: number, specVersionId: number) {
  const manifest = readManifestIfPresent(dataDir, stillsManifestPath(runId), StillsManifestSchema);
  if (manifest?.source?.specVersionId !== specVersionId) return [];
  return Object.keys(manifest.frames).map((beatId) => ({
    beatId,
    path: beatStillPath(runId, beatId),
  }));
}

/** The joined draft, when it was rendered from this version. */
function draftOf(dataDir: string, runId: number, specVersionId: number): string | null {
  const path = runDraftPath(runId);
  const manifest = readManifestIfPresent(dataDir, manifestPathFor(path), DraftManifestSchema);
  return manifest?.source?.specVersionId === specVersionId ? path : null;
}

function readManifestIfPresent<T>(
  dataDir: string,
  path: string,
  schema: { parse: (value: unknown) => T },
): T | undefined {
  if (!existsSync(resolveDataPath(dataDir, path))) return undefined;
  return schema.parse(readDataJson(dataDir, path));
}
