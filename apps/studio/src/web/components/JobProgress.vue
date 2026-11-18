<script setup lang="ts">
import { computed } from 'vue';
import { useJobEvents } from '#web/composables/useJobEvents.ts';
import { summarizeJob } from '#web/lib/job-summary.ts';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ jobId: number }>();

const stream = useJobEvents(() => props.jobId);
const summary = computed(() => summarizeJob(stream.events.value));
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString();
</script>

<template>
  <div class="space-y-4" data-testid="job-progress">
    <div class="flex items-center gap-3">
      <span class="label-mono text-ink-muted">Job #{{ jobId }}</span>
      <StatusBadge v-if="summary.status" :status="summary.status" data-testid="job-status" />
      <span class="label-mono text-ink-faint">stream: {{ stream.state.value }}</span>
    </div>

    <div class="h-1.5 overflow-hidden rounded-full bg-panel-raised">
      <div
        class="h-full bg-concept shadow-[0_0_12px_var(--color-concept)] transition-[width] duration-500"
        :style="{ width: `${summary.pct}%` }"
        data-testid="job-bar"
      />
    </div>

    <p v-if="summary.error" class="font-mono text-xs text-problem">{{ summary.error }}</p>
    <p v-if="stream.error.value" class="font-mono text-xs text-problem">
      {{ stream.error.value }}
    </p>

    <ol class="space-y-1 font-mono text-xs">
      <li
        v-for="event in summary.progress"
        :key="event.id"
        class="flex gap-4 text-ink-muted"
        data-testid="progress-event"
      >
        <span class="text-ink-faint">{{ formatTime(event.createdAt) }}</span>
        <span class="w-12 text-right text-ink">{{ Math.round(event.payload.pct) }}%</span>
        <span>{{ event.payload.message }}</span>
      </li>
    </ol>
  </div>
</template>
