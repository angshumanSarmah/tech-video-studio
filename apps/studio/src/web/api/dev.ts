import { JobDtoSchema, type JobDto } from '@explainer-studio/shared';
import { postJson } from './client.ts';

/** Queues a run-less demo job (dev server only). Stream it with `useJobEvents(job.id)`. */
export function startNoopJob(): Promise<JobDto> {
  return postJson('/dev/noop-job', JobDtoSchema);
}
