import { existsSync } from 'node:fs';
import {
  aliasProblems,
  HOUSE_STYLE_VERSION,
  parseHouseSvg,
} from '@explainer-studio/renderer/catalog';
import {
  ApproveDraftRequestSchema,
  CreateDraftRequestSchema,
  MAX_AUTO_DRAFTS_PER_VIDEO,
  toJsonPath,
  type AssetDraftState,
  type AssetDraftVariant,
  type AssetFamily,
  type AssetNote,
  type AssetNoteKind,
  type AssetStatus,
  type VideoSpec,
} from '@explainer-studio/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { SpecAssetRequest } from '../assets/run-asset-requests.ts';
import {
  assetDraftSheetPath,
  assetSvgPath,
  readDataJson,
  readDataText,
  resolveDataPath,
  writeDataText,
} from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { listAssetRequestsFor, type AssetRequestRow } from '../db/repositories/asset-requests.ts';
import { listJobsByStatus, type Job } from '../db/repositories/jobs.ts';
import type { Run } from '../db/repositories/runs.ts';
import { getLatestSpecVersion } from '../db/repositories/spec-versions.ts';
import { assets, jobs, llmCalls, runs } from '../db/schema.ts';
import { ConflictError, InvalidEditError, NotFoundError } from '../errors.ts';
import { queueJobIn } from './jobs.ts';

/**
 * Asset drafts (P1C.12 A4): a new asset asked for (by hand, or by a run's asset request) is an
 * `assets` row with status `draft` and no SVG, and a `draft_asset` job that has the Asset
 * drafter draw it (`#worker/jobs/draft-asset.ts`). The reviewer approves one variant into the
 * library, rejects the row, or regenerates it with a note. **Nothing is ever approved
 * automatically**, whatever a run's gates are set to.
 */

export const DRAFT_ASSET_JOB_TYPE = 'draft_asset';

export type AssetRow = typeof assets.$inferSelect;

/** A `draft_asset` job's payload: the round to draw; a run's request names its run. */
export interface DraftJobPayload {
  readonly assetId: string;
  readonly round: number;
  /** The run whose asset request queued it (auto-drafting), counted against its video's cap. */
  readonly requestedByRunId?: number;
}

// ---------------------------------------------------------------------------------------------
// Asking for a draft

/** A draft asked for by hand: a new row and its first round queued. */
export function createDraft(tx: Executor, input: unknown): { row: AssetRow; job: Job } {
  const request = parseOrThrow(CreateDraftRequestSchema, input, 'The draft cannot be started');
  const { name, family, description } = request;
  const id = request.id ?? slugOf(name);
  assertNewId(tx, id);
  const row = insertDraft(tx, { id, name, family, description });
  return { row, job: queueDraftJob(tx, { assetId: id, round: 1 }) };
}

/**
 * Auto-drafting (a run's `board_backlog`): each requested id the library has no row for gets a
 * draft and its job, while the run's video has queued fewer than `MAX_AUTO_DRAFTS_PER_VIDEO`
 * and the run's `assets.autoDraft` is on. An id with a row (a draft, a rejected one) is left as
 * it is: its request row is the record. Returns the jobs queued.
 */
export function queueRequestedDrafts(
  tx: Executor,
  run: Run,
  requests: readonly SpecAssetRequest[],
): Job[] {
  if (!run.resolvedSettings.assets.autoDraft) return [];
  let room = MAX_AUTO_DRAFTS_PER_VIDEO - videoAutoDrafts(tx, run).length;
  const queued: Job[] = [];
  for (const request of requests) {
    if (room <= 0) break;
    if (assetRow(tx, request.assetId) || aliasOwner(tx, request.assetId)) continue;
    const { assetId: id, family, description } = request;
    insertDraft(tx, { id, name: nameOf(id), family, description });
    queued.push(queueDraftJob(tx, { assetId: id, round: 1, requestedByRunId: run.id }));
    room -= 1;
  }
  return queued;
}

/** The `draft_asset` jobs a run's video (the run, its parent, its sibling parts) queued itself. */
export function videoAutoDrafts(db: Executor, run: Run): Job[] {
  const root = run.parentRunId ?? run.id;
  const videoRuns = new Set(
    db
      .select({ id: runs.id })
      .from(runs)
      .where(or(eq(runs.id, root), eq(runs.parentRunId, root)))
      .all()
      .map((r) => r.id),
  );
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.type, DRAFT_ASSET_JOB_TYPE))
    .all()
    .filter((job) => {
      const by = (job.payload as Partial<DraftJobPayload> | null)?.requestedByRunId;
      return typeof by === 'number' && videoRuns.has(by);
    });
}

// ---------------------------------------------------------------------------------------------
// Reviewer decisions

/**
 * Approves one variant (P1C.12 A4): its house SVG becomes `assets/<id>.svg` and the row is in the
 * library, licence `LicenseRef-own`, source `drafted:<prompt>`. Only a draft, only a variant the
 * sanitizer passed, never while a round is being drawn. The id stays; aliases name it otherwise.
 */
export function approveDraft(tx: Executor, dataDir: string, id: string, input: unknown): AssetRow {
  const request = parseOrThrow(ApproveDraftRequestSchema, input, 'The draft cannot be approved');
  const row = requireDraftRow(tx, id, ['draft'], 'approved');
  assertNotDrafting(tx, id);
  const variant = row.variants.find((v) => v.number === request.variant);
  if (!variant?.svgPath) {
    throw new InvalidEditError(`Variant ${request.variant} of ${id} cannot be approved.`, [
      { path: '$.variant', message: approvableMessage(row) },
    ]);
  }
  const aliases = request.aliases ?? row.aliases;
  assertAliases(tx, id, aliases);
  const svg = parseHouseSvg(readDataText(dataDir, variant.svgPath));
  if (!svg.ok) throw new Error(`${variant.svgPath}: ${svg.problems.join(' ')}`);
  const svgPath = writeDataText(dataDir, assetSvgPath(id), readDataText(dataDir, variant.svgPath));
  return updateRow(tx, id, {
    status: 'approved',
    svgPath,
    approvedVariant: variant.number,
    name: request.name ?? row.name,
    family: request.family ?? row.family,
    tags: request.tags ?? row.tags,
    aliases,
    licence: 'LicenseRef-own',
    source: `drafted:${variant.prompt}`,
    styleVersion: HOUSE_STYLE_VERSION,
    error: null,
    notes: withNote(row, 'approve', request.note ?? `Approved variant ${variant.number}.`),
  });
}

/** Rejects a draft with a note; regenerating it later starts a new round. */
export function rejectDraft(tx: Executor, id: string, note: string): AssetRow {
  const row = requireDraftRow(tx, id, ['draft'], 'rejected');
  assertNotDrafting(tx, id);
  return updateRow(tx, id, { status: 'rejected', notes: withNote(row, 'reject', note) });
}

/**
 * Draws a draft (or a rejected row) again: a new round, the note as the drafter's feedback. The
 * earlier rounds' variants stay (and stay approvable on a draft).
 */
export function regenerateDraft(
  tx: Executor,
  id: string,
  note: string,
): { row: AssetRow; job: Job } {
  const row = requireDraftRow(tx, id, ['draft', 'rejected'], 'regenerated');
  assertNotDrafting(tx, id);
  const updated = updateRow(tx, id, {
    status: 'draft',
    error: null,
    notes: withNote(row, 'regenerate', note),
  });
  return { row: updated, job: queueDraftJob(tx, { assetId: id, round: latestRound(row) + 1 }) };
}

// ---------------------------------------------------------------------------------------------
// Reading

export function assetRow(db: Executor, id: string): AssetRow | undefined {
  return db.select().from(assets).where(eq(assets.id, id)).get();
}

export function requireAsset(db: Executor, id: string): AssetRow {
  const row = assetRow(db, id);
  if (!row) throw new NotFoundError('Asset', id);
  return row;
}

export interface AssetListFilter {
  readonly status?: AssetStatus | undefined;
  readonly family?: AssetFamily | undefined;
  /** Every word must match the id, name, a tag or an alias (substring, any case). */
  readonly q?: string | undefined;
}

export function listAssets(db: Executor, filter: AssetListFilter = {}): AssetRow[] {
  const where = and(
    filter.status ? eq(assets.status, filter.status) : undefined,
    filter.family ? eq(assets.family, filter.family) : undefined,
  );
  const rows = db.select().from(assets).where(where).orderBy(assets.id).all();
  const words = (filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const text = [row.id, row.name, ...row.tags, ...row.aliases].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The queued or running `draft_asset` job of an id, if any. */
export function activeDraftJob(db: Executor, id: string): Job | undefined {
  return [...listJobsByStatus(db, 'queued'), ...listJobsByStatus(db, 'running')].find(
    (job) =>
      job.type === DRAFT_ASSET_JOB_TYPE &&
      (job.payload as Partial<DraftJobPayload> | null)?.assetId === id,
  );
}

/** What a row shows (see `ASSET_DRAFT_STATES`). */
export function draftState(row: AssetRow, job: Job | undefined): AssetDraftState {
  if (row.status !== 'draft') return row.status;
  if (job) return job.status === 'running' ? 'drafting' : 'queued';
  const round = latestRound(row);
  return row.variants.some((v) => v.round === round && v.svgPath) ? 'ready' : 'failed';
}

export interface AssetDetail {
  readonly row: AssetRow;
  readonly state: AssetDraftState;
  readonly job: Job | undefined;
  readonly sheetPath: string | null;
  readonly requests: AssetRequestRow[];
  readonly costUsd: number;
}

export function assetDetail(db: Executor, dataDir: string, id: string): AssetDetail {
  const row = requireAsset(db, id);
  const job = activeDraftJob(db, id);
  const round = latestRound(row);
  const sheet = round > 0 ? assetDraftSheetPath(id, round) : null;
  return {
    row,
    state: draftState(row, job),
    job,
    sheetPath: sheet && existsSync(resolveDataPath(dataDir, sheet)) ? sheet : null,
    requests: listAssetRequestsFor(db, id),
    costUsd: draftCostUsd(db, row.variants),
  };
}

/** What drafting cost, every round (the variants' `llm_calls`). */
export function draftCostUsd(db: Executor, variants: readonly AssetDraftVariant[]): number {
  const ids = [...new Set(variants.flatMap((v) => v.callIds))];
  if (ids.length === 0) return 0;
  return db
    .select({ cost: llmCalls.costUsd })
    .from(llmCalls)
    .where(inArray(llmCalls.id, ids))
    .all()
    .reduce((sum, r) => sum + r.cost, 0);
}

/** The newest round with variants; 0 before the first is drawn. */
export function latestRound(row: Pick<AssetRow, 'variants'>): number {
  return Math.max(0, ...row.variants.map((v) => v.round));
}

/** Variants numbered after every earlier one (round 2 starts at 4). */
export function nextVariantNumber(row: Pick<AssetRow, 'variants'>): number {
  return Math.max(0, ...row.variants.map((v) => v.number)) + 1;
}

// ---------------------------------------------------------------------------------------------
// Helpers

function queueDraftJob(tx: Executor, payload: DraftJobPayload): Job {
  return queueJobIn(tx, { type: DRAFT_ASSET_JOB_TYPE, payload: { ...payload } });
}

function insertDraft(
  tx: Executor,
  draft: { id: string; name: string; family: AssetFamily; description: string },
): AssetRow {
  return tx
    .insert(assets)
    .values({
      ...draft,
      tags: tagsOf(draft.name),
      licence: 'LicenseRef-own',
      source: 'drafted',
      styleVersion: HOUSE_STYLE_VERSION,
      status: 'draft',
    })
    .returning()
    .get();
}

function updateRow(tx: Executor, id: string, set: Partial<typeof assets.$inferInsert>): AssetRow {
  const row = tx
    .update(assets)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning()
    .get();
  if (!row) throw new NotFoundError('Asset', id);
  return row;
}

function withNote(row: AssetRow, kind: AssetNoteKind, text: string): AssetNote[] {
  const note: AssetNote = {
    at: new Date().toISOString(),
    kind,
    round: latestRound(row),
    text: text.trim(),
  };
  return [...row.notes, note];
}

function requireDraftRow(
  tx: Executor,
  id: string,
  allowed: readonly AssetStatus[],
  verb: string,
): AssetRow {
  const row = requireAsset(tx, id);
  if (!allowed.includes(row.status)) {
    throw new ConflictError(`Asset ${id} is ${row.status}: it cannot be ${verb}.`);
  }
  return row;
}

function assertNotDrafting(tx: Executor, id: string): void {
  const job = activeDraftJob(tx, id);
  if (job) {
    throw new ConflictError(`Asset ${id} is being drafted (job ${job.id}): wait for it to finish.`);
  }
}

function assertNewId(tx: Executor, id: string): void {
  const row = assetRow(tx, id);
  if (row) {
    const hint =
      row.status === 'approved' ? 'it is in the library' : `regenerate the ${row.status} one`;
    throw new ConflictError(`Asset "${id}" already exists (${row.status}): ${hint}.`);
  }
  const owner = aliasOwner(tx, id);
  if (owner) throw new ConflictError(`"${id}" is an alias of ${owner}: use that asset.`);
}

function assertAliases(tx: Executor, id: string, aliases: readonly string[]): void {
  const others = tx
    .select({ id: assets.id, aliases: assets.aliases })
    .from(assets)
    .all()
    .filter((r) => r.id !== id);
  const problems = aliasProblems([...others, { id, aliases: [...aliases] }]);
  if (problems.length > 0) {
    throw new InvalidEditError(
      'The draft cannot be approved: its aliases are taken.',
      problems.map((message) => ({ path: '$.aliases', message })),
    );
  }
}

function aliasOwner(tx: Executor, id: string): string | undefined {
  return tx
    .select({ id: assets.id, aliases: assets.aliases })
    .from(assets)
    .all()
    .find((r) => r.aliases.includes(id))?.id;
}

function approvableMessage(row: AssetRow): string {
  const ok = row.variants.filter((v) => v.svgPath).map((v) => v.number);
  return ok.length > 0
    ? `Approve one the sanitizer passed: ${ok.join(', ')}.`
    : 'No variant passed the sanitizer: regenerate it with a note.';
}

function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
  message: string,
): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidEditError(
      `${message}: its details are not valid.`,
      parsed.error.issues.map((i) => ({ path: toJsonPath(i.path), message: i.message })),
    );
  }
  return parsed.data;
}

/** A library id from a display name: "Write-ahead log" -> `write_ahead_log`. */
export function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'asset'
  );
}

/** A display name from an id: `write_ahead_log` -> "Write ahead log". */
export function nameOf(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
}

function tagsOf(name: string): string[] {
  return [
    ...new Set(
      name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1),
    ),
  ].slice(0, 12);
}

// ---------------------------------------------------------------------------------------------
// What the drafter is told about where the asset is used

/** Narration this many characters long at most, per use. */
const USED_IN_MAX_CHARS = 320;
/** Uses (runs' requests) the drafter reads. */
const USED_IN_MAX = 3;

export interface DraftRequestContext {
  /** Narration of the beats whose boards asked for it, newest request first. */
  readonly usedIn: string[];
  /** The approved ids those boards would use instead. */
  readonly closest: string[];
}

/** Where runs asked for the asset: each request's first beat's narration, and its `closest`. */
export function draftRequestContext(
  db: Executor,
  dataDir: string,
  id: string,
): DraftRequestContext {
  const requests = listAssetRequestsFor(db, id).slice(0, USED_IN_MAX);
  const usedIn = requests.flatMap((request) => {
    const narration = requestNarration(db, dataDir, request);
    return narration ? [narration.slice(0, USED_IN_MAX_CHARS)] : [];
  });
  return { usedIn: [...new Set(usedIn)], closest: [...new Set(requests.map((r) => r.closest))] };
}

function requestNarration(db: Executor, dataDir: string, request: AssetRequestRow): string | null {
  const beatId = request.beatIds[0];
  if (request.runId === null || !beatId) return null;
  const latest = getLatestSpecVersion(db, request.runId);
  if (!latest) return null;
  const spec = readDataJson(dataDir, latest.jsonPath) as VideoSpec;
  return spec.script?.find((s) => s.beatId === beatId)?.narration ?? null;
}
