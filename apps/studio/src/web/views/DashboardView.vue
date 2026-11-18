<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorMessage } from '#web/api/client.ts';
import { startNoopJob } from '#web/api/dev.ts';
import JobProgress from '#web/components/JobProgress.vue';
import PageHeader from '#web/components/PageHeader.vue';
import RunsTable from '#web/components/RunsTable.vue';
import { useRunsStore } from '#web/stores/runs.ts';

const runs = useRunsStore();
const jobId = ref<number | null>(null);
const starting = ref(false);
const startError = ref<string | null>(null);

onMounted(() => runs.load());

async function start(): Promise<void> {
  starting.value = true;
  startError.value = null;
  try {
    jobId.value = (await startNoopJob()).id;
  } catch (e) {
    startError.value = errorMessage(e);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="space-y-10">
    <PageHeader title="Dashboard" />

    <section class="rounded border border-line bg-panel/80 p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="label-mono text-ink-muted">Noop job</h2>
        <button
          type="button"
          class="label-mono rounded-sm border border-concept/60 px-3 py-1.5 text-concept transition hover:bg-concept/10 disabled:opacity-50"
          :disabled="starting"
          data-testid="start-noop"
          @click="start"
        >
          Start noop job
        </button>
      </div>
      <p v-if="startError" class="font-mono text-xs text-problem">{{ startError }}</p>
      <JobProgress v-if="jobId !== null" :key="jobId" :job-id="jobId" />
      <p v-else class="text-sm text-ink-faint">
        Queues a demo job in the worker and streams its progress here.
      </p>
    </section>

    <section class="rounded border border-line bg-panel/80 p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="label-mono text-ink-muted">Runs</h2>
        <button
          type="button"
          class="label-mono text-ink-faint hover:text-ink"
          :disabled="runs.loading"
          @click="runs.load()"
        >
          Refresh
        </button>
      </div>
      <p v-if="runs.error" class="font-mono text-xs text-problem">{{ runs.error }}</p>
      <RunsTable v-else :runs="runs.items" />
    </section>
  </div>
</template>
