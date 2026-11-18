/** Filter and start cursor for `GET /api/events` (see `EventsQuerySchema`). */
export type EventStreamFilter =
  | { readonly runId: number; readonly after?: number }
  | { readonly jobId: number; readonly after?: number };

export function eventsUrl(filter: EventStreamFilter): string {
  const params = new URLSearchParams();
  if ('runId' in filter) params.set('runId', String(filter.runId));
  else params.set('jobId', String(filter.jobId));
  if (filter.after !== undefined) params.set('after', String(filter.after));
  return `/api/events?${params.toString()}`;
}
