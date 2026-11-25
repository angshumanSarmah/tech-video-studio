import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { posix } from 'node:path';
import { PATTERNS, PRIMITIVES } from '@explainer-studio/renderer/catalog';
import {
  ATTACHMENT_EXTENSIONS,
  backlogItems,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  mergeAvoidNames,
  referenceDevices,
  referenceRecordProblems,
  ReferenceRecordSchema,
  type AvoidName,
  type CreateReferenceRequest,
  type ReferenceAttachment,
  type ReferenceCheckContext,
  type ReferenceRecord,
  type UnmappedItem,
} from '@explainer-studio/shared';
import {
  readDataJson,
  readDataText,
  referenceAttachmentPath,
  referenceBreakdownPath,
  referenceRecordPath,
  resolveDataPath,
  writeDataFileOnce,
  writeDataJson,
  writeDataText,
} from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import {
  listReferenceBacklog,
  syncReferenceBacklog,
  type BacklogRequest,
} from '../db/repositories/backlog.ts';
import { listJobsByStatus, type Job } from '../db/repositories/jobs.ts';
import {
  getReference,
  getReferenceBySlug,
  insertReference,
  listReferenceRows,
  updateReference,
  type ReferenceRow,
} from '../db/repositories/references.ts';
import { ConflictError, InvalidEditError, InvalidSourceError, NotFoundError } from '../errors.ts';
import { queueJobIn } from './jobs.ts';

/**
 * The reference library (P1C.11): structure-only records of videos the person admires. A pasted
 * breakdown is stored with its screenshots (never sent to a model) and an `analyze_reference`
 * job turns it into a record (the Reference analyst); a record is saved only once it passes
 * `referenceRecordProblems`, and its buildable unmapped items become backlog rows. Seeds come
 * from committed files (`reference-seed.ts`) and never call a model.
 */

export const ANALYZE_REFERENCE_JOB_TYPE = 'analyze_reference';

/** The checks' context: the live registries, plus what the breakdown quotes and extra names. */
export function referenceCheckContext(
  extra: { breakdown?: string; extraNames?: readonly AvoidName[] } = {},
): ReferenceCheckContext {
  return {
    primitiveIds: new Set(PRIMITIVES.keys()),
    patternIds: new Set(PATTERNS.keys()),
    ...extra,
  };
}

/** A record checked as the analyst's answer is: the schema, then every code check. */
export function checkReferenceRecord(
  value: unknown,
  ctx: ReferenceCheckContext,
): { record: ReferenceRecord } | { issues: { path: string; message: string }[] } {
  const parsed = ReferenceRecordSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({
        path: ['$', ...i.path].join('.'),
        message: i.message,
      })),
    };
  }
  const problems = referenceRecordProblems(parsed.data, ctx);
  if (problems.length > 0) {
    return { issues: problems.map((p) => ({ path: p.path, message: `${p.code}: ${p.message}` })) };
  }
  return { record: parsed.data };
}

/** A backlog row's description: what it shows, when it could be built, our closest id. */
export function backlogDescription(item: UnmappedItem): string {
  const phase = item.buildable === 'phase_2' ? ' (phase 2)' : '';
  const closest = item.closest ? ` (closest: ${item.closest})` : '';
  return `${item.description}${phase}${closest}`;
}

/**
 * Writes a checked record, copies its list fields onto the row (ready) and syncs its backlog
 * rows. Returns the row and the backlog rows it added.
 */
export function saveReferenceRecord(
  tx: Executor,
  dataDir: string,
  row: ReferenceRow,
  record: ReferenceRecord,
  extra: { seedHash?: string } = {},
): { row: ReferenceRow; added: BacklogRequest[] } {
  const recordPath = writeDataJson(dataDir, referenceRecordPath(row.slug), record);
  const saved = updateReference(tx, row.id, {
    title: record.title,
    topicClass: record.topicClass,
    devices: referenceDevices(record),
    status: 'ready',
    error: null,
    recordPath,
    ...extra,
  });
  const items = backlogItems(record).map((item) => ({
    name: item.name,
    description: backlogDescription(item),
  }));
  return { row: saved, added: syncReferenceBacklog(tx, row.id, items) };
}

export function markReferenceFailed(db: Executor, id: number, error: string): ReferenceRow {
  return updateReference(db, id, { status: 'failed', error });
}

// ---------------------------------------------------------------------------------------------
// Reading

export function requireReference(db: Executor, idOrSlug: number | string): ReferenceRow {
  const row =
    typeof idOrSlug === 'number' ? getReference(db, idOrSlug) : getReferenceBySlug(db, idOrSlug);
  if (row) return row;
  if (typeof idOrSlug === 'number') throw new NotFoundError('Reference', idOrSlug);
  throw new InvalidSourceError(`No reference "${idOrSlug}": see pnpm studio references.`);
}

export function listReferences(db: Executor): ReferenceRow[] {
  return listReferenceRows(db);
}

/** The row's record, or null before its first analysis. */
export function readReferenceRecord(dataDir: string, row: ReferenceRow): ReferenceRecord | null {
  if (!row.recordPath || !existsSync(resolveDataPath(dataDir, row.recordPath))) return null;
  return ReferenceRecordSchema.parse(readDataJson(dataDir, row.recordPath));
}

export function readReferenceBreakdown(dataDir: string, row: ReferenceRow): string {
  return readDataText(dataDir, row.breakdownPath);
}

export interface ReferenceDetail {
  readonly row: ReferenceRow;
  readonly breakdown: string;
  readonly record: ReferenceRecord | null;
  readonly backlog: BacklogRequest[];
}

export function referenceDetail(db: Executor, dataDir: string, id: number): ReferenceDetail {
  const row = requireReference(db, id);
  return {
    row,
    breakdown: readReferenceBreakdown(dataDir, row),
    record: readReferenceRecord(dataDir, row),
    backlog: listReferenceBacklog(db, row.id),
  };
}

// ---------------------------------------------------------------------------------------------
// Adding, editing, analysing again

export interface Attachment {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * A pasted breakdown: its file, its screenshots and its row (pending), and the analyst's job,
 * in one transaction (`tx`). The slug comes from the title (or the breakdown's first heading).
 */
export function addReference(
  tx: Executor,
  dataDir: string,
  request: CreateReferenceRequest,
  attachments: readonly Attachment[] = [],
): { row: ReferenceRow; job: Job } {
  assertAttachments(attachments);
  const title = request.title ?? firstHeading(request.breakdown) ?? 'Pasted reference';
  const slug = uniqueSlug(tx, title);
  const breakdownPath = writeDataText(
    dataDir,
    referenceBreakdownPath(slug),
    `${request.breakdown}\n`,
  );
  const stored = attachments.map((a) => storeAttachment(dataDir, slug, a));
  const row = insertReference(tx, {
    slug,
    title,
    origin: 'pasted',
    status: 'pending',
    breakdownPath,
    attachments: stored,
  });
  const job = queueAnalysis(tx, row.id, request.namesToAvoid ?? []);
  return { row, job };
}

/**
 * A person's edit of the whole record, checked like the analyst's answer (`InvalidEditError`
 * with the issues; nothing saved). A seed's edit is kept until its committed files change.
 */
export function editReferenceRecord(
  tx: Executor,
  dataDir: string,
  id: number,
  value: unknown,
): { row: ReferenceRow; added: BacklogRequest[] } {
  const row = requireReference(tx, id);
  assertNotQueued(tx, row.id);
  const breakdown = readReferenceBreakdown(dataDir, row);
  const checked = checkReferenceRecord(value, referenceCheckContext({ breakdown }));
  if ('issues' in checked) {
    throw new InvalidEditError(
      `Reference ${row.slug}: the record fails its checks.`,
      checked.issues,
    );
  }
  return saveReferenceRecord(tx, dataDir, row, checked.record);
}

/**
 * Runs the analyst again on the stored breakdown. The record's names to avoid go with it, so
 * an analysis never drops a name the person gave.
 */
export function reanalyzeReference(tx: Executor, dataDir: string, id: number): Job {
  const row = requireReference(tx, id);
  assertNotQueued(tx, row.id);
  const names = readReferenceRecord(dataDir, row)?.namesToAvoid ?? [];
  updateReference(tx, row.id, { status: 'pending', error: null });
  return queueAnalysis(tx, row.id, names);
}

function queueAnalysis(tx: Executor, referenceId: number, names: readonly AvoidName[]): Job {
  const payload = names.length > 0 ? { referenceId, namesToAvoid: names } : { referenceId };
  return queueJobIn(tx, { type: ANALYZE_REFERENCE_JOB_TYPE, payload });
}

/** The analysis job queued or running for a reference, if any. */
export function pendingAnalysis(db: Executor, referenceId: number): Job | undefined {
  return [...listJobsByStatus(db, 'queued'), ...listJobsByStatus(db, 'running')].find(
    (job) =>
      job.type === ANALYZE_REFERENCE_JOB_TYPE &&
      (job.payload as { referenceId?: unknown } | null)?.referenceId === referenceId,
  );
}

function assertNotQueued(db: Executor, referenceId: number): void {
  const job = pendingAnalysis(db, referenceId);
  if (job) {
    throw new ConflictError(
      `Reference ${referenceId} is being analysed (job ${job.id}): wait for it to finish.`,
    );
  }
}

/** The names a record carries plus the person's, for a saved analysis. */
export function withNames(record: ReferenceRecord, names: readonly AvoidName[]): ReferenceRecord {
  return { ...record, namesToAvoid: mergeAvoidNames(record.namesToAvoid, names) };
}

// ---------------------------------------------------------------------------------------------
// Slugs and attachments

/** Lowercase ASCII words joined by "-", at most 48 characters. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'reference';
}

function uniqueSlug(db: Executor, title: string): string {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; getReferenceBySlug(db, slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** The first Markdown heading's text ("# Reference: …" without its "Reference:" label). */
export function firstHeading(text: string): string | undefined {
  const heading = /^#{1,3}\s+(.+)$/m.exec(text)?.[1]?.trim();
  return heading?.replace(/^reference:\s*/i, '').slice(0, 80) || undefined;
}

function attachmentExtension(name: string): string | undefined {
  const ext = posix.extname(name.toLowerCase());
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext) ? ext : undefined;
}

function assertAttachments(attachments: readonly Attachment[]): void {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new InvalidSourceError(`At most ${MAX_ATTACHMENTS} screenshots per reference.`);
  }
  for (const a of attachments) {
    if (!attachmentExtension(a.name)) {
      throw new InvalidSourceError(
        `${a.name}: screenshots are ${ATTACHMENT_EXTENSIONS.join(', ')} files.`,
      );
    }
    if (a.bytes.byteLength === 0) throw new InvalidSourceError(`${a.name} is empty.`);
    if (a.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new InvalidSourceError(
        `${a.name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`,
      );
    }
  }
}

function storeAttachment(dataDir: string, slug: string, a: Attachment): ReferenceAttachment {
  const hash = createHash('sha256').update(a.bytes).digest('hex');
  const ext = attachmentExtension(a.name) ?? '.png';
  const path = writeDataFileOnce(dataDir, referenceAttachmentPath(slug, hash, ext), a.bytes);
  return { path, name: posix.basename(a.name.replaceAll('\\', '/')), bytes: a.bytes.byteLength };
}
