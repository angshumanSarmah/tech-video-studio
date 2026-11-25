import { z } from 'zod';
import {
  JobStatusEventSchema,
  GateEventSchema,
  LogEventSchema,
  ProgressEventSchema,
  RunStatusEventSchema,
} from '../domain/events.ts';
import { IdParamSchema } from './common.ts';

/**
 * Query for `GET /api/events` (SSE). Filter by `runId` or `jobId` (not both: a job implies its
 * run), or neither for every event (dashboard).
 *
 * Where the stream starts, first match wins:
 * 1. `Last-Event-ID` header (browser reconnect).
 * 2. `after`: events with a greater id. Pass `lastEventId` from `GET /api/runs/:id` so a page
 *    load streams only what happened since its snapshot.
 * 3. With `runId` or `jobId`: replay from the start (fallback). Without a filter: live only.
 */
export const EventsQuerySchema = z
  .object({
    runId: IdParamSchema.optional(),
    jobId: IdParamSchema.optional(),
    after: z.coerce.number().int().nonnegative().optional(),
  })
  .refine((q) => q.runId === undefined || q.jobId === undefined, {
    message: 'Pass runId or jobId, not both',
    path: ['jobId'],
  });
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

const EventMetaShape = {
  id: z.number().int(),
  runId: z.number().int().nullable(),
  jobId: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
};

/** SSE `data` of each event; the SSE `id` is `id` and the SSE `event` is `type`. */
export const EventDtoSchema = z.discriminatedUnion('type', [
  RunStatusEventSchema.extend(EventMetaShape),
  JobStatusEventSchema.extend(EventMetaShape),
  ProgressEventSchema.extend(EventMetaShape),
  LogEventSchema.extend(EventMetaShape),
  GateEventSchema.extend(EventMetaShape),
]);
export type EventDto = z.infer<typeof EventDtoSchema>;
