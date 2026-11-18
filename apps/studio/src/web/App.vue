<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchHealth } from '#web/http/health.ts';
import { routes } from '#web/router.ts';

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
  <div class="bg-blueprint flex h-full">
    <aside class="flex w-56 shrink-0 flex-col border-r border-line bg-canvas/90">
      <div class="border-b border-line px-5 py-5">
        <p class="label-mono text-concept">Explainer</p>
        <p class="label-mono text-ink">Studio</p>
      </div>
      <nav class="flex-1 py-3">
        <RouterLink
          v-for="route in routes"
          :key="route.name"
          :to="{ name: route.name }"
          class="label-mono block border-l-2 border-transparent px-5 py-2 text-ink-muted hover:text-ink"
          exact-active-class="border-concept! bg-concept/10 text-ink!"
          data-testid="nav-link"
        >
          {{ route.meta.title }}
        </RouterLink>
      </nav>
      <p
        class="label-mono border-t border-line px-5 py-3"
        :class="status === 'error' ? 'text-problem' : 'text-ink-faint'"
        data-testid="server-status"
      >
        Server: {{ status }}
      </p>
    </aside>
    <main class="min-w-0 flex-1 overflow-y-auto px-10 py-8">
      <RouterView />
    </main>
  </div>
</template>
