import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_PORT = '8787';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  const apiTarget = `http://localhost:${env['PORT'] ?? DEFAULT_PORT}`;

  return {
    root: fileURLToPath(new URL('./src/web', import.meta.url)),
    envDir: workspaceRoot,
    plugins: [vue()],
    server: {
      proxy: { '/api': apiTarget },
    },
    build: {
      outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
      emptyOutDir: true,
    },
  };
});
