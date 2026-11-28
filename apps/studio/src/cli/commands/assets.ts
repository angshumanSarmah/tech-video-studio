import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { AssetListQuerySchema, type RunMissingAssetsResponse } from '@explainer-studio/shared';
import { latestEventId } from '#core/db/repositories/events.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import {
  approveDraftAndRefresh,
  resolveMissingAsset,
  runMissingAssets,
} from '#core/services/missing-assets.ts';
import { driveRun } from '../session.ts';
import { missingItemLines } from '../summaries.ts';
import { resolveDataPath } from '#core/data-files.ts';
import type { Job } from '#core/db/repositories/jobs.ts';
import {
  activeDraftJob,
  assetDetail,
  createDraft,
  draftState,
  listAssets,
  regenerateDraft,
  rejectDraft,
  type AssetDetail,
} from '#core/services/asset-drafts.ts';
import { uploadAsset } from '#core/services/asset-upload.ts';
import type { AssetsCommand } from '../args.ts';
import { CliError, EXIT, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { waitForJob } from '../proposals.ts';

type Command<A extends AssetsCommand['action']> = Extract<AssetsCommand, { action: A }>;

/** `studio assets …` (P1C.12): the asset library and its drafts through the API's services. */
export async function assetsCommand(ctx: CliContext, cmd: AssetsCommand): Promise<number> {
  try {
    return await run(ctx, cmd);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'InvalidEditError') throw error;
    const issues = (error as Error & { issues: readonly { path: string; message: string }[] })
      .issues;
    ctx.io.err(error.message);
    for (const issue of issues) ctx.io.err(`  ${issue.path}: ${issue.message}`);
    return EXIT.failed;
  }
}

async function run(ctx: CliContext, cmd: AssetsCommand): Promise<number> {
  switch (cmd.action) {
    case 'list':
      return list(ctx, cmd);
    case 'show':
      for (const line of detailLines(ctx, assetDetail(ctx.db, ctx.config.dataDir, cmd.id))) {
        ctx.io.out(line);
      }
      return EXIT.ok;
    case 'add':
      return add(ctx, cmd);
    case 'draft':
      return withWorker(ctx, cmd.dryRun, async () => {
        const { row, job } = ctx.db.transaction((tx) =>
          createDraft(tx, {
            name: cmd.name,
            family: cmd.family,
            description: cmd.description,
            ...(cmd.id ? { id: cmd.id } : {}),
          }),
        );
        ctx.io.out(`Draft ${row.id} started; the Asset drafter draws it (job ${job.id}).`);
        return settle(ctx, row.id, job);
      });
    case 'approve':
      return approve(ctx, cmd);
    case 'missing':
      for (const line of missingLines(
        ctx,
        runMissingAssets(ctx.db, ctx.config.dataDir, cmd.runId),
      )) {
        ctx.io.out(line);
      }
      return EXIT.ok;
    case 'resolve':
      return resolveMissing(ctx, cmd);
    case 'reject': {
      ctx.db.transaction((tx) => rejectDraft(tx, cmd.id, cmd.note));
      ctx.io.out(
        `Rejected ${cmd.id}. Draw it again with: pnpm studio assets regenerate ${cmd.id} --note "…"`,
      );
      return EXIT.ok;
    }
    case 'regenerate':
      return withWorker(ctx, cmd.dryRun, async () => {
        const { job } = ctx.db.transaction((tx) => regenerateDraft(tx, cmd.id, cmd.note));
        ctx.io.out(`The Asset drafter draws ${cmd.id} again with your note (job ${job.id}).`);
        return settle(ctx, cmd.id, job);
      });
  }
}

function list(ctx: CliContext, cmd: Command<'list'>): number {
  const filter = AssetListQuerySchema.safeParse({
    ...(cmd.status ? { status: cmd.status } : {}),
    ...(cmd.family ? { family: cmd.family } : {}),
    ...(cmd.q ? { q: cmd.q } : {}),
  });
  if (!filter.success) {
    throw new CliError(`Cannot list assets: ${filter.error.issues[0]?.message ?? ''}`);
  }
  const rows = listAssets(ctx.db, filter.data);
  if (rows.length === 0) ctx.io.out('No assets.');
  for (const row of rows) {
    const state = draftState(row, activeDraftJob(ctx.db, row.id));
    const shown = state === row.status ? state : `${row.status} (${state})`;
    ctx.io.out(`${row.id.padEnd(28)} ${row.family.padEnd(9)} ${shown.padEnd(18)} ${row.name}`);
  }
  return EXIT.ok;
}

function add(ctx: CliContext, cmd: Command<'add'>): number {
  const path = isAbsolute(cmd.file) ? cmd.file : resolve(ctx.io.cwd, cmd.file);
  if (!existsSync(path)) throw new CliError(`No such file: ${cmd.file}`);
  const { asset, fixes } = uploadAsset(ctx.db, ctx.config.dataDir, {
    svg: readFileSync(path, 'utf8'),
    id: cmd.id,
    name: cmd.name,
    family: cmd.family,
    tags: cmd.tags,
    aliases: cmd.aliases,
    ...(cmd.description ? { description: cmd.description } : {}),
    ...(cmd.licence ? { licence: cmd.licence } : {}),
    ...(cmd.source ? { source: cmd.source } : {}),
  });
  ctx.io.out(
    `Added ${asset.id} (${asset.family}, ${asset.licence}): ${asset.svgPath ?? ''}, approved.`,
  );
  for (const fix of fixes) ctx.io.out(`  fixed: ${fix}`);
  return EXIT.ok;
}

async function approve(ctx: CliContext, cmd: Command<'approve'>): Promise<number> {
  const request = {
    variant: cmd.variant,
    ...(cmd.tags ? { tags: cmd.tags } : {}),
    ...(cmd.aliases ? { aliases: cmd.aliases } : {}),
    ...(cmd.note ? { note: cmd.note } : {}),
  };
  return withWorker(ctx, cmd.dryRun, async () => {
    const after = latestEventId(ctx.db);
    const { row, refreshed } = approveDraftAndRefresh(ctx.db, ctx.config.dataDir, cmd.id, request);
    ctx.io.out(
      `Approved ${row.id} (variant ${cmd.variant}): ${row.svgPath ?? ''}, in the library.`,
    );
    return followRefreshed(ctx, refreshed, after);
  });
}

/** Each run an approval sent back to render, followed until it waits again. */
async function followRefreshed(
  ctx: CliContext,
  refreshed: readonly number[],
  after: number,
): Promise<number> {
  let code: number = EXIT.ok;
  for (const runId of refreshed) {
    ctx.io.out(`Run ${runId} renders again with it.`);
    const run = getRun(ctx.db, runId);
    code = Math.max(code, await driveRun(ctx, run?.parentRunId ?? runId, after, []));
  }
  return code;
}

async function resolveMissing(ctx: CliContext, cmd: Command<'resolve'>): Promise<number> {
  return withWorker(ctx, cmd.dryRun, async () => {
    const after = latestEventId(ctx.db);
    const result = resolveMissingAsset(
      ctx.db,
      ctx.config.dataDir,
      cmd.runId,
      cmd.id,
      cmd.resolution,
    );
    ctx.io.out(resolvedLine(cmd, result.run.step));
    if (cmd.resolution.action === 'skip') return EXIT.ok;
    const others = result.refreshed.filter((id) => id !== cmd.runId);
    const run = getRun(ctx.db, cmd.runId);
    const code = await driveRun(ctx, run?.parentRunId ?? cmd.runId, after, []);
    return Math.max(code, await followRefreshed(ctx, others, after));
  });
}

function resolvedLine(cmd: Command<'resolve'>, step: string): string {
  const r = cmd.resolution;
  if (r.action === 'approve-draft') {
    return `Approved ${cmd.id} (variant ${r.variant}); run ${cmd.runId} goes to ${step}.`;
  }
  if (r.action === 'swap') {
    return `Swapped ${cmd.id} for ${r.to} in run ${cmd.runId}; it goes to ${step}.`;
  }
  return `Skipped ${cmd.id}: it stays a placeholder and the final render is refused.`;
}

/** A run's missing assets for the terminal, with what to do about each. */
export function missingLines(ctx: CliContext, missing: RunMissingAssetsResponse): string[] {
  const where = missing.gate ? `the ${missing.gate} gate` : 'its latest spec';
  if (missing.items.length === 0) return [`Run ${missing.runId}: no missing assets (${where}).`];
  const lines = [`Run ${missing.runId}, ${where}: ${missing.items.length} missing asset(s).`];
  for (const item of missing.items) {
    lines.push(...missingItemLines(ctx.config.dataDir, missing.runId, item));
  }
  return lines;
}

/** Waits for the drafting job, then prints the draft (or why it failed). */
async function settle(ctx: CliContext, id: string, queued: Job): Promise<number> {
  const job = await waitForJob(ctx, queued.id);
  if (!job) {
    ctx.io.err(`Stopped waiting; job ${queued.id} goes on. See: pnpm studio assets show ${id}`);
    return EXIT.interrupted;
  }
  const detail = assetDetail(ctx.db, ctx.config.dataDir, id);
  for (const line of detailLines(ctx, detail)) ctx.io.out(line);
  if (job.status === 'failed' && job.error) ctx.io.err(`Job ${job.id} failed: ${job.error}`);
  return detail.state === 'ready' ? EXIT.ok : EXIT.failed;
}

/** A draft (or asset) for the terminal: variants, sheet, requests, notes, cost, what to do. */
export function detailLines(ctx: CliContext, detail: AssetDetail): string[] {
  const { row } = detail;
  const lines = [`${row.id} (${row.family}) · ${row.status} · ${detail.state}: ${row.name}`];
  if (row.description) lines.push(`  ${row.description}`);
  for (const v of row.variants) {
    const mark = v.number === row.approvedVariant ? ' ✓ approved' : '';
    const status = v.svgPath ? v.concept : `refused: ${v.problems[0] ?? ''}`;
    lines.push(`  v${v.number} (round ${v.round}, ${v.model}): ${status}${mark}`);
    if (!v.svgPath) lines.push(`      concept: ${v.concept}`);
  }
  if (row.error) lines.push(`  error: ${row.error}`);
  if (detail.sheetPath)
    lines.push(`  sheet: ${resolveDataPath(ctx.config.dataDir, detail.sheetPath)}`);
  for (const r of detail.requests) {
    const where = r.runId === null ? 'a run since deleted' : `run ${r.runId}`;
    lines.push(`  requested by ${where} (${r.beatIds.join(', ')}), closest ${r.closest}`);
  }
  for (const n of row.notes) lines.push(`  ${n.kind} (round ${n.round}): ${n.text}`);
  if (row.variants.length > 0) lines.push(`  drafting cost: $${detail.costUsd.toFixed(4)}`);
  if (detail.state === 'ready') {
    const ok = row.variants.filter((v) => v.svgPath).map((v) => v.number);
    lines.push(
      `Approve one (${ok.join(', ')}): pnpm studio assets approve ${row.id} --variant ${ok.at(-1) ?? 1}`,
      `Or: pnpm studio assets regenerate ${row.id} --note "…" · assets reject ${row.id} --note "…"`,
    );
  }
  return lines;
}
