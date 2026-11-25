import { latestEventId } from '#core/db/repositories/events.ts';
import { getRun, type Run } from '#core/db/repositories/runs.ts';
import { rerunRun, resumeRun } from '#core/services/run-control.ts';
import { updateRunSettings } from '#core/services/run-settings.ts';
import type { Command } from '../args.ts';
import { CliError, EXIT, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { driveRun } from '../session.ts';

type ResumeCommand = Extract<Command, { kind: 'resume' }>;

/**
 * `studio resume <run>` (P1C.9b): follow a run again. A failed run goes on from its failed step;
 * `--cap` raises the cost cap (a paused run resumes); `--from` / `--only` rerun a step
 * (`rerunRun`). A waiting run shows its gate again; a running one is followed.
 */
export async function resumeCommand(ctx: CliContext, cmd: ResumeCommand): Promise<number> {
  const run = getRun(ctx.db, cmd.runId);
  if (!run) throw new CliError(`Run ${cmd.runId} not found.`);
  if (run.status === 'cancelled')
    throw new CliError(`Run ${run.id} was cancelled: start a new run.`);
  const root = run.parentRunId ?? run.id;
  return withWorker(ctx, cmd.dryRun, async () => {
    const after = latestEventId(ctx.db);
    act(ctx, run, cmd);
    const now = getRun(ctx.db, run.id)!;
    if (now.status === 'paused') {
      ctx.io.out(`Run ${run.id} is paused at its cost cap: add --cap <usd> to raise it.`);
      return EXIT.failed;
    }
    // A waiting or finished run shows where it stands again; a moving one only what is new.
    const moving = now.status === 'running' || now.status === 'queued';
    return driveRun(ctx, root, moving ? after : 0);
  });
}

function act(ctx: CliContext, run: Run, cmd: ResumeCommand): void {
  if (cmd.capUsd !== undefined) {
    updateRunSettings(ctx.db, ctx.config.dataDir, {
      runId: run.id,
      patch: { budget: { maxRunUsd: cmd.capUsd } },
      priceOf: (model) => ctx.appSettings().llm.prices[model],
    });
    ctx.io.out(`Run ${run.id}: cost cap set to $${cmd.capUsd.toFixed(2)}.`);
  }
  const step = cmd.only ?? cmd.from;
  if (step !== undefined) {
    rerunRun(ctx.db, ctx.config.dataDir, run.id, { from: step, only: cmd.only !== undefined });
    ctx.io.out(`Run ${run.id}: rerunning ${cmd.only ? `${step} only` : `from ${step}`}.`);
  } else if (getRun(ctx.db, run.id)!.status === 'failed') {
    resumeRun(ctx.db, ctx.config.dataDir, run.id);
    ctx.io.out(`Run ${run.id}: resumed at ${run.pipelineStep}.`);
  }
}
