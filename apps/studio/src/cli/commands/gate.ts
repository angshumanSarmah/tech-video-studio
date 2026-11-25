import { latestEventId } from '#core/db/repositories/events.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { PIPELINE } from '#core/orchestrator/pipeline.ts';
import type { Command } from '../args.ts';
import { CliError, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { applyDecision, driveRun } from '../session.ts';

type GateCommand = Extract<Command, { kind: 'gate' }>;

/** `studio gate <run> …` (P1C.9b): a decision at the gate the run waits at, then the run followed. */
export async function gateCommand(ctx: CliContext, cmd: GateCommand): Promise<number> {
  const run = getRun(ctx.db, cmd.runId);
  if (!run) throw new CliError(`Run ${cmd.runId} not found.`);
  const step = PIPELINE[run.pipelineStep];
  if (run.status !== 'awaiting_review' || step.kind !== 'gate') {
    throw new CliError(
      `Run ${run.id} is not waiting at a gate (${run.status} at ${run.pipelineStep}): ` +
        `pnpm studio status ${run.id}`,
    );
  }
  const root = run.parentRunId ?? run.id;
  return withWorker(ctx, cmd.dryRun, async () => {
    const after = latestEventId(ctx.db);
    applyDecision(ctx, run.id, step.gate, cmd.decision);
    return driveRun(ctx, root, after);
  });
}
