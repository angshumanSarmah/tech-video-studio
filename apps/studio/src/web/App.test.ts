import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows ok when the server is healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok', uptimeSeconds: 1 }))),
    );
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('[data-testid="server-status"]').text()).toBe('Server: ok');
  });

  it('shows error when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('[data-testid="server-status"]').text()).toBe('Server: error');
  });
});
