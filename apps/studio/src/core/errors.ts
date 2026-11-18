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
