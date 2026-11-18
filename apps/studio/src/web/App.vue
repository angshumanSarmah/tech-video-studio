<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchHealth } from '#web/api/health.ts';

const status = ref<'checking' | 'ok' | 'error'>('checking');

onMounted(async () => {
  try {
    await fetchHealth();
    status.value = 'ok';
  } catch {
    status.value = 'error';
  }
});
</script>

<template>
  <main>
    <h1>Explainer Studio</h1>
    <p data-testid="server-status">Server: {{ status }}</p>
  </main>
</template>
