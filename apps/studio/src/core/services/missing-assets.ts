import {
  buildAssetRegistry,
  rankAssets,
  withAssetSwapped,
} from '@explainer-studio/renderer/catalog';
import {
  GateDecisionRequestSchema,
  ResolveMissingAssetRequestSchema,
  toJsonPath,
  type MissingAssetDto,
  type MissingAssetRequest,
  type ResolveMissingAssetResponse,
  type RunMissingAssetsResponse,
  type VideoSpec,
} from '@explainer-studio/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { loadAssetLibrary } from '../assets/library.ts';
import { approvedIds, specMissingAssets, specUsedIds } from '../assets/missing-uses.ts';
import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { getRun, setStepRequests, type Run } from '../db/repositories/runs.ts';
import { requireRun } from '../orchestrator/snapshot.ts';
import { getLatestSpecVersion } from '../db/repositories/spec-versions.ts';
import { runs } from '../db/schema.ts';
import { ConflictError, InvalidEditError } from '../errors.ts';
import {
  activeDraftJob,
  approveDraft,
  assetDetail,
  assetRow,
  draftState,
  type AssetRow,
} from './asset-drafts.ts';
import { decideAtGateIn } from './gate-decisions.ts';
import { currentSubject, readSpecVersion } from './gates.ts';
import { rerunRunIn } from './run-control.ts';

/**
 * A run's missing assets (P1C.12 A5): ids its boards use that the library lacks (drawn as
 * placeholders; the final render refuses them), read live from what the gate it waits at reviews
 * (else its latest spec), each with its uses, the Generator's request, its draft and the closest
 * approved assets. At gate 3 or 4 each can be resolved: a draft variant approved (no spec change:
 * the run renders its stills, or its draft, again; the draft cache re-renders only clips whose
 * assets changed, and the final check is recomputed), every use swapped to an approved id (a spec
 * edit, then a curate scoped to the changed beats), or skipped (recorded; the final stays
 * blocked). Approving a draft from anywhere refreshes every run waiting at those gates on it.
 */

/** Suggestions listed per missing id. */
export const MISSING_ASSET_SUGGESTIONS = 3;

export type SpecGate = 'scenes' | 'draft';

/** The spec gate a run waits at, if any. */
export function waitingSpecGate(run: Run): SpecGate | null {
  if (run.status !== 'awaiting_review') return null;
  if (run.pipelineStep === 'gate_scenes') return 'scenes';
  if (run.pipelineStep === 'gate_draft') return 'draft';
  return null;
}

function requestsOf(spec: VideoSpec): Map<string, MissingAssetRequest> {
  const byId = new Map<string, MissingAssetRequest>();
  for (const scene of spec.scenes ?? []) {
    for (const r of scene.missingAssetRequests ?? [])
      if (!byId.has(r.assetId)) byId.set(r.assetId, r);
  }
  return byId;
}

interface RunSpec {
  readonly gate: SpecGate | null;
  readonly specVersionId: number | null;
  readonly spec: VideoSpec | null;
}

/** What the run's missing assets are read from: its waiting gate's subject, else its latest spec. */
function runSpec(db: Executor, dataDir: string, run: Run): RunSpec {
  const gate = waitingSpecGate(run);
  const specVersionId = gate
    ? (currentSubject(db, dataDir, run, gate)?.specVersionId ?? null)
    : (getLatestSpecVersion(db, run.id)?.id ?? null);
  const spec =
    specVersionId === null ? null : (readSpecVersion(db, dataDir, specVersionId) ?? null);
  return { gate, specVersionId, spec };
}

export function runMissingAssets(db: Db, dataDir: string, runId: number): RunMissingAssetsResponse {
  const run = requireRun(db, runId);
  const { gate, specVersionId, spec } = runSpec(db, dataDir, run);
  if (!spec) return { runId, gate, specVersionId, items: [] };
  const missing = specMissingAssets(db, spec);
  if (missing.size === 0) return { runId, gate, specVersionId, items: [] };
  const registry = buildAssetRegistry(loadAssetLibrary(db, dataDir).assets);
  const requests = requestsOf(spec);
  const items = [...missing].map(([id, uses]): MissingAssetDto => {
    const request = requests.get(id) ?? null;
    const row = assetRow(db, id);
    const query = { id, ...(request ? { description: request.description } : {}) };
    return {
      id,
      uses,
      beatIds: [...new Set(uses.map((u) => u.beatId))],
      request: request
        ? { description: request.description, family: request.family, closest: request.closest }
        : null,
      draft: row ? draftOf(db, dataDir, row) : null,
      suggestions: rankAssets(query, registry, {
        family: request?.family,
        limit: MISSING_ASSET_SUGGESTIONS,
      }),
    };
  });
  return { runId, gate, specVersionId, items };
}

function draftOf(db: Executor, dataDir: string, row: AssetRow): MissingAssetDto['draft'] {
  return {
    status: row.status,
    state: draftState(row, activeDraftJob(db, row.id)),
    approvable:
      row.status === 'draft' ? row.variants.filter((v) => v.svgPath).map((v) => v.number) : [],
    sheetPath: assetDetail(db, dataDir, row.id).sheetPath,
  };
}

// ---------------------------------------------------------------------------------------------
// Resolving

/**
 * Approves a draft variant and refreshes every run waiting at gate 3 or 4 whose subject uses the
 * id: gate 3 reruns from `stills`, gate 4 from `draft` (only the clips using it render again).
 */
export function approveDraftAndRefresh(
  db: Db,
  dataDir: string,
  id: string,
  input: unknown,
): { row: AssetRow; refreshed: number[] } {
  return db.transaction((tx) => {
    const row = approveDraft(tx, dataDir, id, input);
    return { row, refreshed: refreshWaitingRuns(tx, dataDir, id) };
  });
}

/** Sends each run waiting at a spec gate on `id` back to render again; returns their ids. */
export function refreshWaitingRuns(tx: Executor, dataDir: string, id: string): number[] {
  const waiting = tx
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.status, 'awaiting_review'),
        inArray(runs.pipelineStep, ['gate_scenes', 'gate_draft']),
      ),
    )
    .all();
  const refreshed: number[] = [];
  for (const { id: runId } of waiting) {
    const run = getRun(tx, runId);
    const { gate, spec } = run ? runSpec(tx, dataDir, run) : { gate: null, spec: null };
    if (!run || !gate || !spec || !specUsedIds(spec).includes(id)) continue;
    rerunRunIn(tx, dataDir, run.id, { from: gate === 'scenes' ? 'stills' : 'draft', only: false });
    appendEvent(tx, {
      runId: run.id,
      type: 'log',
      payload: {
        level: 'info',
        message: `Asset ${id} approved: the ${gate === 'scenes' ? 'stills' : 'draft'} render again with it.`,
      },
    });
    refreshed.push(run.id);
  }
  return refreshed;
}

export function resolveMissingAsset(
  db: Db,
  dataDir: string,
  runId: number,
  assetId: string,
  input: unknown,
): ResolveMissingAssetResponse {
  const parsed = ResolveMissingAssetRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidEditError(
      'The missing asset cannot be resolved: the request is not valid.',
      parsed.error.issues.map((i) => ({ path: toJsonPath(i.path), message: i.message })),
    );
  }
  const request = parsed.data;
  return db.transaction((tx) => {
    const run = requireRun(tx, runId);
    const gate = waitingSpecGate(run);
    if (!gate) {
      throw new ConflictError(
        `Run ${runId} is not waiting at the scenes or draft gate (${run.status} at ${run.pipelineStep}).`,
      );
    }
    const subject = runSpec(tx, dataDir, run);
    const missing = subject.spec ? specMissingAssets(tx, subject.spec) : new Map();
    if (!subject.spec || !missing.has(assetId)) {
      throw new ConflictError(
        `"${assetId}" is not missing in run ${runId}'s ${gate} gate subject.`,
      );
    }
    let refreshed: number[] = [];
    switch (request.action) {
      case 'approve-draft': {
        approveDraft(tx, dataDir, assetId, {
          variant: request.variant,
          ...(request.tags ? { tags: request.tags } : {}),
          ...(request.aliases ? { aliases: request.aliases } : {}),
        });
        refreshed = refreshWaitingRuns(tx, dataDir, assetId);
        break;
      }
      case 'swap':
        swapAtGate(tx, dataDir, run, gate, subject, assetId, request.to);
        break;
      case 'skip':
        appendEvent(tx, {
          runId,
          type: 'log',
          payload: {
            level: 'warn',
            message:
              `Missing asset ${assetId} skipped${request.note ? `: ${request.note}` : ''}. ` +
              'It stays a placeholder; the final render is refused until it is resolved.',
          },
        });
        break;
    }
    const after = requireRun(tx, runId);
    return {
      action: request.action,
      run: { status: after.status, step: after.pipelineStep },
      refreshed,
    };
  });
}

/**
 * Every use of `assetId` in the gate's subject set to `to` (approved), saved as the person's edit
 * at that gate; the curate that follows is scoped to the changed beats (a board-only change).
 */
function swapAtGate(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: SpecGate,
  subject: RunSpec,
  assetId: string,
  to: string,
): void {
  if (!approvedIds(tx, [to]).has(to)) {
    throw new InvalidEditError(`Cannot swap ${assetId} for ${to}.`, [
      { path: '$.to', message: `"${to}" is not an approved asset.` },
    ]);
  }
  const swapped = withAssetSwapped(subject.spec!, assetId, to);
  setStepRequests(tx, run.id, {
    ...run.stepRequests,
    edit_curate: { scope: { sinceSpecVersionId: subject.specVersionId! } },
  });
  decideAtGateIn(
    tx,
    dataDir,
    run.id,
    gate,
    GateDecisionRequestSchema.parse({
      action: 'edit',
      subjectId: subject.specVersionId,
      content: swapped.spec,
      notes: `Swapped the missing asset ${assetId} for ${to} on ${swapped.beatIds.join(', ')}.`,
    }),
  );
}
