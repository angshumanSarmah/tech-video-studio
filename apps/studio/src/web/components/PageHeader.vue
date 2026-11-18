<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <header class="mb-8 flex items-end justify-between gap-4 border-b border-line pb-4">
    <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
    <slot />
  </header>
</template>
