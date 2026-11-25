import { z } from 'zod';
import {
  RunSettingsPatchSchema,
  RunSettingsSchema,
  RunStatusSchema,
  StageSchema,
} from '../domain/run.ts';
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
  /** Error of the run's newest failed job (why the run failed), or null. */
  lastError: z.string().nullable(),
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

/**
 * `PUT /api/runs/:id/settings`: the fields to change, merged onto the run's overrides and its
 * settings snapshot (`patchRunSettings`); nothing else changes and settings.json is not re-read,
 * except for the price of a model the snapshot has none for. Only for a run waiting at a gate or
 * paused, never while a job of it is queued or running (409).
 */
export const UpdateRunSettingsRequestSchema = z.strictObject({ settings: RunSettingsPatchSchema });
export type UpdateRunSettingsRequest = z.input<typeof UpdateRunSettingsRequestSchema>;
