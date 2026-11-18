<script setup lang="ts">
import { statusClasses, statusLabel, type Status } from '#web/lib/status.ts';

defineProps<{ status: Status }>();
</script>

<template>
  <span
    class="label-mono inline-block rounded-sm border px-1.5 py-0.5"
    :class="statusClasses(status)"
  >
    {{ statusLabel(status) }}
  </span>
</template>
