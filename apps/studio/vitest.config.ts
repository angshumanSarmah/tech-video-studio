import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{core,server,worker}/**/*.test.ts'],
        },
      },
      {
        plugins: [vue()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/web/**/*.test.ts'],
        },
      },
    ],
  },
});
