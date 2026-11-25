import { parseCommand, USAGE, UsageError } from './args.ts';
import { gateCommand } from './commands/gate.ts';
import { renderCommand } from './commands/render.ts';
import { resumeCommand } from './commands/resume.ts';
import { runCommand } from './commands/run.ts';
import { costCommand, statusCommand } from './commands/status.ts';
import { CliError, EXIT, type CliContext } from './context.ts';
import { decisionErrorText, isDecisionError } from './session.ts';

/**
 * The studio CLI (P1C.9b): parses argv and runs one command through the same core services as
 * the UI. Holds no logic of its own. Returns the exit code; errors a user can act on are printed
 * without a stack.
 */
export async function runCli(argv: readonly string[], ctx: CliContext): Promise<number> {
  try {
    const cmd = parseCommand(argv);
    switch (cmd.kind) {
      case 'help':
        ctx.io.out(USAGE);
        return EXIT.ok;
      case 'run':
        return await runCommand(ctx, cmd);
      case 'gate':
        return await gateCommand(ctx, cmd);
      case 'resume':
        return await resumeCommand(ctx, cmd);
      case 'status':
        return statusCommand(ctx, cmd.runId);
      case 'cost':
        return costCommand(ctx, cmd.runId);
      case 'render':
        return await renderCommand(ctx, cmd);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.io.err(`${error.message}\n\n${USAGE}`);
      return EXIT.usage;
    }
    if (error instanceof CliError || isDecisionError(error) || isServiceError(error)) {
      ctx.io.err(decisionErrorText(error as Error));
      return EXIT.failed;
    }
    throw error;
  }
}

/** Domain errors whose message is meant for the user (bad source, unknown run, a 409's reason). */
function isServiceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      'NotFoundError',
      'InvalidSourceError',
      'RunSettingsConflictError',
      'OrchestratorStateError',
    ].includes(error.name)
  );
}
