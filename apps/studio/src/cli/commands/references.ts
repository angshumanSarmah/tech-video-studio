import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  backlogItems,
  CreateReferenceRequestSchema,
  referenceDevices,
  referencePatterns,
  type ReferenceRecord,
} from '@explainer-studio/shared';
import { readDataText, referenceDir, resolveDataPath, writeDataJson } from '#core/data-files.ts';
import type { BacklogRequest } from '#core/db/repositories/backlog.ts';
import type { Job } from '#core/db/repositories/jobs.ts';
import type { ReferenceRow } from '#core/db/repositories/references.ts';
import {
  addReference,
  editReferenceRecord,
  listReferences,
  reanalyzeReference,
  referenceDetail,
  requireReference,
  type Attachment,
  type ReferenceDetail,
} from '#core/services/references.ts';
import type { ReferencesCommand } from '../args.ts';
import { CliError, EXIT, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { waitForJob } from '../proposals.ts';

/** `studio references …` (P1C.11): the reference library through the same services as the API. */
export async function referencesCommand(ctx: CliContext, cmd: ReferencesCommand): Promise<number> {
  switch (cmd.action) {
    case 'list':
      for (const line of referenceTable(listReferences(ctx.db))) ctx.io.out(line);
      return EXIT.ok;
    case 'show':
      return show(ctx, cmd.ref, cmd.json);
    case 'add':
      return add(ctx, cmd);
    case 'edit':
      return edit(ctx, cmd.ref, cmd.file);
    case 'reanalyze': {
      const row = resolveRef(ctx, cmd.ref);
      return withWorker(ctx, cmd.dryRun, async () => {
        const job = ctx.db.transaction((tx) => reanalyzeReference(tx, ctx.config.dataDir, row.id));
        ctx.io.out(`The Reference analyst reads ${row.slug} again (job ${job.id}).`);
        return settle(ctx, row.id, job);
      });
    }
  }
}

async function add(
  ctx: CliContext,
  cmd: Extract<ReferencesCommand, { action: 'add' }>,
): Promise<number> {
  const breakdown = cmd.file === '-' ? await ctx.io.readStdin() : readFile(ctx, cmd.file);
  const request = CreateReferenceRequestSchema.safeParse({
    breakdown,
    ...(cmd.title ? { title: cmd.title } : {}),
    ...(cmd.avoid.length > 0 ? { namesToAvoid: cmd.avoid } : {}),
  });
  if (!request.success) {
    throw new CliError(`The breakdown cannot be added: ${request.error.issues[0]?.message ?? ''}`);
  }
  const attachments: Attachment[] = cmd.attach.map((file) => ({
    name: basename(file),
    bytes: new Uint8Array(readFileSync(pathOf(ctx, file))),
  }));
  return withWorker(ctx, cmd.dryRun, async () => {
    const { row, job } = ctx.db.transaction((tx) =>
      addReference(tx, ctx.config.dataDir, request.data, attachments),
    );
    const kept = attachments.length > 0 ? `, ${attachments.length} screenshot(s) kept` : '';
    ctx.io.out(
      `Reference ${row.slug} added${kept}; the Reference analyst reads it (job ${job.id}).`,
    );
    return settle(ctx, row.id, job);
  });
}

/** Waits for the analysis, then prints the record (or why it failed). */
async function settle(ctx: CliContext, id: number, queued: Job): Promise<number> {
  const job = await waitForJob(ctx, queued.id);
  if (!job) {
    ctx.io.err(`Stopped waiting; job ${queued.id} goes on. See: pnpm studio references show ${id}`);
    return EXIT.interrupted;
  }
  const detail = referenceDetail(ctx.db, ctx.config.dataDir, id);
  for (const line of detailLines(detail)) ctx.io.out(line);
  return detail.row.status === 'ready' ? EXIT.ok : EXIT.failed;
}

function show(ctx: CliContext, ref: string, json: boolean): number {
  const detail = referenceDetail(ctx.db, ctx.config.dataDir, resolveRef(ctx, ref).id);
  if (json) ctx.io.out(JSON.stringify(detail.record, null, 2));
  else for (const line of detailLines(detail)) ctx.io.out(line);
  return EXIT.ok;
}

/** Saves a record from a file, or (in a terminal) from `$EDITOR` on a copy of the current one. */
async function edit(ctx: CliContext, ref: string, file: string | undefined): Promise<number> {
  const row = resolveRef(ctx, ref);
  const value = file ? readJson(readFile(ctx, file), file) : await editInEditor(ctx, row);
  if (value === undefined) return EXIT.ok;
  const { added } = ctx.db.transaction((tx) =>
    editReferenceRecord(tx, ctx.config.dataDir, row.id, value),
  );
  ctx.io.out(`Reference ${row.slug} saved.`);
  for (const item of added) ctx.io.out(`  backlog +${item.name}: ${item.description}`);
  return EXIT.ok;
}

async function editInEditor(ctx: CliContext, row: ReferenceRow): Promise<unknown> {
  if (!ctx.io.isTTY) {
    throw new CliError(
      `Without a terminal, give the edited record: pnpm studio references edit ${row.slug} <record.json>`,
    );
  }
  const detail = referenceDetail(ctx.db, ctx.config.dataDir, row.id);
  if (!detail.record) throw new CliError(`Reference ${row.slug} has no record yet to edit.`);
  const rel = writeDataJson(
    ctx.config.dataDir,
    `${referenceDir(row.slug)}/cli/edit.json`,
    detail.record,
  );
  await ctx.io.edit(resolveDataPath(ctx.config.dataDir, rel));
  const value = readJson(readDataText(ctx.config.dataDir, rel), rel);
  if (JSON.stringify(value) === JSON.stringify(detail.record)) {
    ctx.io.out('No change: nothing saved.');
    return undefined;
  }
  return value;
}

function resolveRef(ctx: CliContext, ref: string): ReferenceRow {
  return requireReference(ctx.db, /^\d+$/.test(ref) ? Number(ref) : ref);
}

function pathOf(ctx: CliContext, file: string): string {
  const path = isAbsolute(file) ? file : resolve(ctx.io.cwd, file);
  if (!existsSync(path)) throw new CliError(`No such file: ${file}`);
  return path;
}

function readFile(ctx: CliContext, file: string): string {
  return readFileSync(pathOf(ctx, file), 'utf8');
}

function readJson(text: string, from: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CliError(`${from} is not valid JSON: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Pure: what is printed

/** One line per reference, oldest first. */
export function referenceTable(rows: readonly ReferenceRow[]): string[] {
  if (rows.length === 0) return ['No references.'];
  const width = Math.max(...rows.map((r) => r.slug.length));
  return rows.map((r) => {
    const cls = r.topicClass ?? '-';
    const devices = r.devices.length > 0 ? r.devices.join(', ') : '-';
    const error = r.status === 'failed' && r.error ? ` (${r.error.split('\n')[0]})` : '';
    return `  ${r.id}  ${r.slug.padEnd(width)}  ${r.status.padEnd(7)}  ${cls.padEnd(14)}  ${devices}${error}`;
  });
}

export function detailLines(detail: ReferenceDetail): string[] {
  const { row, record, backlog } = detail;
  const head = `Reference ${row.id} ${row.slug} [${row.origin}, ${row.status}]`;
  const attachments =
    row.attachments.length > 0 ? [`  screenshots kept: ${row.attachments.length}`] : [];
  if (!record) {
    return [
      head,
      ...(row.error ? [`  failed: ${row.error}`] : ['  not analysed yet']),
      ...attachments,
    ];
  }
  return [
    head,
    ...(row.status === 'failed' && row.error ? [`  last analysis failed: ${row.error}`] : []),
    ...recordLines(record),
    ...backlogLines(backlog),
    ...attachments,
  ];
}

/** The record in short: class, hook, devices, patterns, beats, unmapped items, names flagged. */
export function recordLines(record: ReferenceRecord): string[] {
  const cls = record.secondaryTopicClass
    ? `${record.topicClass} + ${record.secondaryTopicClass}`
    : record.topicClass;
  const length = record.lengthSec === undefined ? '' : `, about ${record.lengthSec} s`;
  return [
    `  ${record.title} (${cls}, ${record.format}${length}, ${record.beats.length} beats)`,
    `  hook ${record.hook.kind}/${record.hook.device}: ${record.hook.shape}`,
    `  arc: ${record.arc}`,
    `  devices: ${referenceDevices(record).join(', ')}`,
    `  patterns: ${referencePatterns(record).join(', ') || '-'}`,
    ...record.beats.map((b, i) => {
      const cont = b.continuesPrevious ? ' (continues)' : '';
      const ids = [...b.devices, ...b.patterns, ...(b.layoutMode ? [b.layoutMode] : [])];
      return `    ${i} ${b.role}${cont}: ${b.summary}${ids.length > 0 ? ` [${ids.join(', ')}]` : ''}`;
    }),
    ...record.unmapped.map(
      (u) => `  unmapped ${u.name} (${u.kind}, ${u.buildable}): ${u.description}`,
    ),
    `  to the backlog: ${backlogItems(record).length}`,
    `  names flagged: ${record.namesToAvoid.map((n) => `${n.text} (${n.kind})`).join(', ') || '-'}`,
  ];
}

function backlogLines(backlog: readonly BacklogRequest[]): string[] {
  return backlog.map((b) => `  backlog #${b.id} ${b.name} [${b.status}]: ${b.description}`);
}
