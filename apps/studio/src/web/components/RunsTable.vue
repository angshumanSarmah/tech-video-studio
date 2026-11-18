<script setup lang="ts">
import type { RunDto } from '@explainer-studio/shared';
import StatusBadge from './StatusBadge.vue';

defineProps<{ runs: readonly RunDto[] }>();

const formatTime = (iso: string) => new Date(iso).toLocaleString();
</script>

<template>
  <p v-if="runs.length === 0" class="label-mono text-ink-faint" data-testid="runs-empty">
    No runs yet
  </p>
  <table v-else class="w-full text-left text-sm">
    <thead class="label-mono text-ink-muted">
      <tr class="border-b border-line">
        <th class="py-2 pr-4 font-normal">Run</th>
        <th class="py-2 pr-4 font-normal">Status</th>
        <th class="py-2 pr-4 font-normal">Stage</th>
        <th class="py-2 pr-4 font-normal">Topic</th>
        <th class="py-2 font-normal">Created</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="run in runs"
        :key="run.id"
        class="border-b border-line/50 align-top"
        data-testid="run-row"
      >
        <td class="py-2 pr-4 font-mono">#{{ run.id }}</td>
        <td class="py-2 pr-4">
          <StatusBadge :status="run.status" />
          <p
            v-if="run.lastError"
            class="mt-1 max-w-md font-mono text-xs break-words text-problem"
            data-testid="run-error"
          >
            {{ run.lastError }}
          </p>
        </td>
        <td class="py-2 pr-4 font-mono text-ink-muted">{{ run.currentStage ?? '—' }}</td>
        <td class="py-2 pr-4 font-mono text-ink-muted">#{{ run.topicId }}</td>
        <td class="py-2 text-ink-muted">{{ formatTime(run.createdAt) }}</td>
      </tr>
    </tbody>
  </table>
</template>
