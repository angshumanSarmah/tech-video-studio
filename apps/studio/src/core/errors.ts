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
