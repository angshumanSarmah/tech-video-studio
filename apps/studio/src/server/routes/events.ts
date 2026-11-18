import { EventsQuerySchema, type EventsQuery } from '@explainer-studio/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { Db } from '#core/db/client.ts';
import { latestEventId, listEventsSince, type EventFilter } from '#core/db/repositories/events.ts';
import { getJob } from '#core/db/repositories/jobs.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';
import { toEventDto } from '../dto.ts';
import { validate } from '../validate.ts';

export interface EventStreamOptions {
  /** How often to poll `events` for new rows. */
  readonly pollMs: number;
  /** Idle time before a keep-alive comment is sent. */
  readonly heartbeatMs: number;
}

export const DEFAULT_EVENT_STREAM_OPTIONS: EventStreamOptions = {
  pollMs: 500,
  heartbeatMs: 15_000,
};

const BATCH_SIZE = 100;

interface Tail {
  readonly filter: EventFilter;
  readonly afterId: number;
}

/**
 * SSE over the `events` table. Each message has `id` = event id, `event` = event type and
 * `data` = EventDto JSON. Browsers resend the last id as `Last-Event-ID` on reconnect.
 */
export function createEventsRoute(db: Db, options = DEFAULT_EVENT_STREAM_OPTIONS) {
  return new Hono().get('/', validate('query', EventsQuerySchema), (c) => {
    const query = c.req.valid('query');
    assertOwnerExists(db, query);
    const filter = { runId: query.runId, jobId: query.jobId };
    const afterId = startCursor(db, query, c.req.header('Last-Event-ID'));
    return streamSSE(c, (stream) => streamTail(db, stream, { filter, afterId }, options));
  });
}

function assertOwnerExists(db: Db, { runId, jobId }: EventsQuery): void {
  if (runId !== undefined && !getRun(db, runId)) throw new NotFoundError('Run', runId);
  if (jobId !== undefined && !getJob(db, jobId)) throw new NotFoundError('Job', jobId);
}

/**
 * First match wins: `Last-Event-ID` (reconnect), then `after` (snapshot cursor from
 * `GET /api/runs/:id`), then a full replay for one run or job, else live from the newest event.
 */
function startCursor(db: Db, query: EventsQuery, lastEventId: string | undefined): number {
  if (lastEventId !== undefined) return parseLastEventId(lastEventId);
  if (query.after !== undefined) return query.after;
  const filtered = query.runId !== undefined || query.jobId !== undefined;
  return filtered ? 0 : latestEventId(db);
}

function parseLastEventId(value: string): number {
  if (!/^\d+$/.test(value)) throw new HTTPException(400, { message: 'Invalid Last-Event-ID' });
  return Number(value);
}

async function streamTail(
  db: Db,
  stream: SSEStreamingApi,
  tail: Tail,
  options: EventStreamOptions,
): Promise<void> {
  let cursor = tail.afterId;
  let idleMs = 0;
  while (!stream.aborted) {
    const batch = listEventsSince(db, { ...tail.filter, afterId: cursor, limit: BATCH_SIZE });
    for (const event of batch) {
      await stream.writeSSE({
        id: String(event.id),
        event: event.type,
        data: JSON.stringify(toEventDto(event)),
      });
      cursor = event.id;
    }
    if (batch.length === BATCH_SIZE) continue;
    idleMs = batch.length > 0 ? 0 : idleMs + options.pollMs;
    if (idleMs >= options.heartbeatMs) {
      await stream.write(': keep-alive\n\n');
      idleMs = 0;
    }
    await stream.sleep(options.pollMs);
  }
}
