import { z } from 'zod';
import { RunSettingsSchema, RunStatusSchema, StageSchema } from '../domain/run.ts';
import { listOf } from './common.ts';

export const CreateRunRequestSchema = z.strictObject({
  topicId: z.number().int().positive(),
  seriesId: z.number().int().positive(),
  settings: RunSettingsSchema.optional(),
});
export type CreateRunRequest = z.input<typeof CreateRunRequestSchema>;

export const RunDtoSchema = z.object({
  id: z.number().int(),
  topicId: z.number().int(),
  seriesId: z.number().int(),
  status: RunStatusSchema,
  currentStage: StageSchema.nullable(),
  settings: RunSettingsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RunDto = z.infer<typeof RunDtoSchema>;

/** `GET /api/runs/:id`. `lastEventId` is the SSE cursor for this snapshot (0 when no events). */
export const RunDetailDtoSchema = RunDtoSchema.extend({
  lastEventId: z.number().int().nonnegative(),
});
export type RunDetailDto = z.infer<typeof RunDetailDtoSchema>;

export const RunListResponseSchema = listOf(RunDtoSchema);
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
