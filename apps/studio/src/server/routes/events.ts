import { RunEventsQuerySchema } from '@explainer-studio/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { Db } from '#core/db/client.ts';
import { latestRunEventId, listRunEventsSince } from '#core/db/repositories/run-events.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';
import { toRunEventDto } from '../dto.ts';
import { validate } from '../validate.ts';

export interface EventStreamOptions {
  /** How often to poll `run_events` for new rows. */
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
  readonly runId: number | undefined;
  readonly afterId: number;
}

/**
 * SSE over the `run_events` table. Each message has `id` = event id, `event` = event type and
 * `data` = RunEventDto JSON. Browsers resend the last id as `Last-Event-ID` on reconnect.
 */
export function createEventsRoute(db: Db, options = DEFAULT_EVENT_STREAM_OPTIONS) {
  return new Hono().get('/', validate('query', RunEventsQuerySchema), (c) => {
    const { runId } = c.req.valid('query');
    if (runId !== undefined && !getRun(db, runId)) throw new NotFoundError('Run', runId);
    const tail = { runId, afterId: startCursor(db, runId, c.req.header('Last-Event-ID')) };
    return streamSSE(c, (stream) => streamTail(db, stream, tail, options));
  });
}

/** Resume after `Last-Event-ID`; else a run replays from its start and the dashboard goes live. */
function startCursor(db: Db, runId: number | undefined, lastEventId: string | undefined): number {
  if (lastEventId !== undefined) return parseLastEventId(lastEventId);
  return runId === undefined ? latestRunEventId(db) : 0;
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
    const batch = listRunEventsSince(db, { runId: tail.runId, afterId: cursor, limit: BATCH_SIZE });
    for (const event of batch) {
      await stream.writeSSE({
        id: String(event.id),
        event: event.type,
        data: JSON.stringify(toRunEventDto(event)),
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
