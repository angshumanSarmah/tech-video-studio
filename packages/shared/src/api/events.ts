import { z } from 'zod';
import { RunEventPayloadSchema, RunEventTypeSchema } from '../domain/job.ts';
import { IdParamSchema } from './common.ts';

/**
 * Query for `GET /api/events` (SSE). With `runId`, streams that run's events from the start;
 * without it, streams new events for all runs (dashboard). `Last-Event-ID` overrides the start.
 */
export const RunEventsQuerySchema = z.object({ runId: IdParamSchema.optional() });
export type RunEventsQuery = z.infer<typeof RunEventsQuerySchema>;

/** SSE `data` of each event; the SSE `id` is `id` and the SSE `event` is `type`. */
export const RunEventDtoSchema = z.object({
  id: z.number().int(),
  runId: z.number().int(),
  jobId: z.number().int().nullable(),
  type: RunEventTypeSchema,
  payload: RunEventPayloadSchema,
  createdAt: z.iso.datetime(),
});
export type RunEventDto = z.infer<typeof RunEventDtoSchema>;
