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

export const RunListResponseSchema = listOf(RunDtoSchema);
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
