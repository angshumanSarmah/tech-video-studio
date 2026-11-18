import type { RunDetailDto } from '@explainer-studio/shared';
import { computed, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { errorMessage } from '#web/http/client.ts';
import { getRun } from '#web/http/runs.ts';
import { useEventStream } from './useEventStream.ts';

/**
 * Loads a run snapshot (`GET /api/runs/:id`), then streams only the events after it
 * (`after=lastEventId`), so a page load never replays history the snapshot already reflects.
 */
export function useRunEvents(runId: MaybeRefOrGetter<number>) {
  const run = shallowRef<RunDetailDto | null>(null);
  const loadError = ref<string | null>(null);

  watch(
    () => toValue(runId),
    async (id) => {
      run.value = null;
      loadError.value = null;
      try {
        const snapshot = await getRun(id);
        if (toValue(runId) === id) run.value = snapshot;
      } catch (error) {
        if (toValue(runId) === id) loadError.value = errorMessage(error);
      }
    },
    { immediate: true },
  );

  const stream = useEventStream(() =>
    run.value ? { runId: run.value.id, after: run.value.lastEventId } : null,
  );

  return {
    run,
    events: stream.events,
    state: stream.state,
    error: computed(() => loadError.value ?? stream.error.value),
    close: stream.close,
  };
}
