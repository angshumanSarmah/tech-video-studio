import { z } from 'zod';
import { JobStatusSchema } from '../domain/job.ts';

/** A job as the browser sees it (payload, lock and attempt columns stay server-side). */
export const JobDtoSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  runId: z.number().int().nullable(),
  status: JobStatusSchema,
  createdAt: z.iso.datetime(),
});
export type JobDto = z.infer<typeof JobDtoSchema>;
