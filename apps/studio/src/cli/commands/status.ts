import { listRunGates } from '#core/db/repositories/gates.ts';
import { runCostUsd } from '#core/db/repositories/llm-calls.ts';
import { getRunSummary, listPartRuns, listRuns } from '#core/db/repositories/runs.ts';
import { getSeries } from '#core/db/repositories/series.ts';
import { getTopic } from '#core/db/repositories/topics.ts';
import { videoBudget } from '#core/services/budget.ts';
import { describeLock, isHeld, readWorkerLock } from '#core/services/worker-lock.ts';
import { CliError, EXIT, type CliContext } from '../context.ts';
import { runLabel } from '../follow.ts';
import { clip } from '../summaries.ts';
import { costTable } from '../session.ts';

const RECENT_RUNS = 15;

/** `studio status [<run>]` (P1C.9b): recent runs, or one run in detail, and the worker lock. */
export function statusCommand(ctx: CliContext, runId: number | undefined): number {
  if (runId === undefined) {
    for (const line of recentRuns(ctx)) ctx.io.out(line);
  } else {
    for (const line of runDetail(ctx, runId)) ctx.io.out(line);
  }
  ctx.io.out(lockLine(ctx));
  return EXIT.ok;
}

/** `studio cost <run>`: the LLM cost per role over the run and its parts, against the cap. */
export function costCommand(ctx: CliContext, runId: number): number {
  const run = getRunSummary(ctx.db, runId);
  if (!run) throw new CliError(`Run ${runId} not found.`);
  const root = run.parentRunId ?? run.id;
  for (const line of costTable(ctx, root)) ctx.io.out(line);
  const budget = videoBudget(ctx.db, root);
  if (budget) ctx.io.out(`  cap           $${budget.capUsd.toFixed(2)} (budget.maxRunUsd)`);
  return EXIT.ok;
}

function recentRuns(ctx: CliContext): string[] {
  const runs = listRuns(ctx.db)
    .filter((r) => r.parentRunId === null)
    .sort((a, b) => b.id - a.id)
    .slice(0, RECENT_RUNS);
  if (runs.length === 0)
    return ['No runs yet: pnpm studio run "<topic>" --series ai --source <url>'];
  return [
    `${'run'.padEnd(5)} ${'status'.padEnd(16)} ${'step'.padEnd(16)} ${'cost'.padStart(8)}  topic`,
    ...runs.map(
      (r) =>
        `${String(r.id).padEnd(5)} ${r.status.padEnd(16)} ${r.pipelineStep.padEnd(16)} ` +
        `${`$${runCostUsd(ctx.db, r.id).toFixed(3)}`.padStart(8)}  ${clip(getTopic(ctx.db, r.topicId)?.title ?? '?', 48)}`,
    ),
  ];
}

function runDetail(ctx: CliContext, runId: number): string[] {
  const run = getRunSummary(ctx.db, runId);
  if (!run) throw new CliError(`Run ${runId} not found.`);
  const topic = getTopic(ctx.db, run.topicId);
  const auto = Object.entries(run.settings.autoApprove)
    .filter(([, on]) => on)
    .map(([gate]) => gate);
  const lines = [
    `${runLabel(run)}: "${topic?.title ?? '?'}" · ${getSeries(ctx.db, run.seriesId)?.name ?? '?'}`,
    `  ${run.status} at ${run.pipelineStep}${run.holdGate ? ` (gate ${run.holdGate} held for review)` : ''}`,
    `  auto-approve: ${auto.length > 0 ? auto.join(', ') : 'none'}`,
    ...listRunGates(ctx.db, run.id).map(
      (g) =>
        `  gate ${g.gate.padEnd(11)} ${g.status}${g.decidedBy ? ` (${g.decidedBy})` : ''}` +
        `${g.carriedFrom ? `, carried from ${g.carriedFrom}` : ''}`,
    ),
    ...listPartRuns(ctx.db, run.id).map(
      (p) => `  ${runLabel(p)}: ${p.status} at ${p.pipelineStep}`,
    ),
    `  cost $${runCostUsd(ctx.db, run.id).toFixed(4)}`,
  ];
  if (run.lastError && run.status === 'failed') lines.push(`  error: ${clip(run.lastError, 200)}`);
  return lines;
}

function lockLine(ctx: CliContext): string {
  const lock = readWorkerLock(ctx.db);
  if (!lock || !isHeld(lock, { host: lock.host }, new Date())) {
    return 'Worker: none running (pnpm dev, or a studio command, starts one).';
  }
  return `Worker: ${describeLock(lock)}, since ${lock.acquiredAt.toISOString()}.`;
}
