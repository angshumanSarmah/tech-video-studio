import type { RunDto } from '@explainer-studio/shared';
import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { errorMessage } from '#web/http/client.ts';
import { listRuns } from '#web/http/runs.ts';

/** The runs list, shared by pages that show it. Server state only: no UI state in stores. */
export const useRunsStore = defineStore('runs', () => {
  const items = shallowRef<readonly RunDto[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      items.value = await listRuns();
    } catch (e) {
      error.value = errorMessage(e);
    } finally {
      loading.value = false;
    }
  }

  return { items, loading, error, load };
});
