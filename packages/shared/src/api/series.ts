import { z } from 'zod';
import { listOf } from './common.ts';

export const SeriesDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Stable slug. */
  tag: z.string(),
  /** HUD display text. */
  label: z.string(),
  accentColour: z.string(),
});
export type SeriesDto = z.infer<typeof SeriesDtoSchema>;

export const SeriesListResponseSchema = listOf(SeriesDtoSchema);
export type SeriesListResponse = z.infer<typeof SeriesListResponseSchema>;
