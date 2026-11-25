/** A referenced entity does not exist. The server maps it to 404. */
export class NotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id: number,
  ) {
    super(`${entity} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

/**
 * The request is valid but the entity is not in a state that allows it (a run not waiting at the
 * gate, a stale subject, a job running). The server maps it to 409.
 */
export class ConflictError extends Error {
  override readonly name = 'ConflictError';
}

/** A user's edit that fails its schema or validation; nothing was saved. The server maps it to 400. */
export class InvalidEditError extends Error {
  override readonly name = 'InvalidEditError';

  constructor(
    message: string,
    readonly issues: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(message);
  }
}

/**
 * A run's LLM spend has reached its cap (`budget.maxRunUsd`, P1C.9): thrown by the LLM client
 * before a request, so nothing more is billed. The worker requeues the job (attempt refunded)
 * and pauses the run; raising the cap resumes it.
 */
export class RunBudgetReachedError extends Error {
  override readonly name = 'RunBudgetReachedError';

  constructor(
    readonly runId: number,
    readonly spentUsd: number,
    readonly capUsd: number,
    /** The run whose cap it is: `runId`, or a part's parent (the cap covers the whole video). */
    readonly capRunId: number = runId,
  ) {
    super(
      capRunId === runId
        ? `Run ${runId} has spent $${spentUsd.toFixed(4)} of its $${capUsd.toFixed(2)} cap ` +
            '(budget.maxRunUsd): raise the cap to resume it.'
        : `Run ${runId} is a part of run ${capRunId}'s video, which has spent ` +
            `$${spentUsd.toFixed(4)} of its $${capUsd.toFixed(2)} cap (budget.maxRunUsd on run ` +
            `${capRunId}): raise the cap on run ${capRunId} to resume it.`,
    );
  }
}
