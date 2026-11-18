import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { createAppRouter } from './router.ts';
import { installFakeEventSource, stubFetch } from './testing.ts';

beforeEach(installFakeEventSource);
afterEach(() => vi.unstubAllGlobals());

async function mountAt(path: string) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount(App, { global: { plugins: [createPinia(), router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('App', () => {
  it('shows the left nav in order', async () => {
    stubFetch({
      'GET /api/health': { status: 'ok', uptimeSeconds: 1 },
      'GET /api/runs': { items: [] },
    });
    const { wrapper } = await mountAt('/');
    expect(wrapper.findAll('[data-testid="nav-link"]').map((l) => l.text())).toEqual([
      'Dashboard',
      'Runs',
      'Assets',
      'References',
      'Memory',
      'Settings',
    ]);
  });

  it('shows ok when the server is healthy', async () => {
    stubFetch({
      'GET /api/health': { status: 'ok', uptimeSeconds: 1 },
      'GET /api/runs': { items: [] },
    });
    const { wrapper } = await mountAt('/');
    expect(wrapper.get('[data-testid="server-status"]').text()).toBe('Server: ok');
  });

  it('shows error when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    const { wrapper } = await mountAt('/');
    expect(wrapper.get('[data-testid="server-status"]').text()).toBe('Server: error');
  });

  it('renders placeholder pages with their title', async () => {
    stubFetch({ 'GET /api/health': { status: 'ok', uptimeSeconds: 1 } });
    const { wrapper } = await mountAt('/memory');
    expect(wrapper.get('h1').text()).toBe('Memory');
    expect(wrapper.find('[data-testid="placeholder"]').exists()).toBe(true);
  });

  it('redirects unknown paths to the dashboard', async () => {
    stubFetch({
      'GET /api/health': { status: 'ok', uptimeSeconds: 1 },
      'GET /api/runs': { items: [] },
    });
    const { router } = await mountAt('/nope');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });
});
