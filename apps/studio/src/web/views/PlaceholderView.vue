<script setup lang="ts">
import { useRoute } from 'vue-router';
import PageHeader from '#web/components/PageHeader.vue';

const route = useRoute();
</script>

<template>
  <div>
    <PageHeader :title="route.meta.title" />
    <p class="label-mono text-ink-faint" data-testid="placeholder">Not built yet</p>
  </div>
</template>
