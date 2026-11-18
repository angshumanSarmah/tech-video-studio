import type { EventDto } from '@explainer-studio/shared';
import { toValue, type MaybeRefOrGetter } from 'vue';
import { useEventStream } from './useEventStream.ts';

/** A job never leaves `done` or `failed`. */
export function isJobFinished(event: EventDto): boolean {
  return event.type === 'job_status' && ['done', 'failed'].includes(event.payload.status);
}

/**
 * Streams one job's events from its first one (a full replay, so nothing that happened before
 * the subscription is missed) and closes once the job finishes. `null` means no job yet.
 */
export function useJobEvents(jobId: MaybeRefOrGetter<number | null>) {
  return useEventStream(
    () => {
      const id = toValue(jobId);
      return id === null ? null : { jobId: id };
    },
    { closeWhen: isJobFinished },
  );
}
