import { fileURLToPath } from 'node:url';
import { EnvSchema } from '@explainer-studio/shared';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_WEB_PORT = 4310;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  // Same schema (and default) the server uses; an empty value counts as unset, as in parseEnv.
  const apiPort = EnvSchema.shape.PORT.parse(env['PORT'] || undefined);
  const webPort = Number(env['WEB_PORT'] || DEFAULT_WEB_PORT);

  return {
    root: fileURLToPath(new URL('./src/web', import.meta.url)),
    envDir: workspaceRoot,
    plugins: [vue(), tailwindcss()],
    server: {
      port: webPort,
      strictPort: true,
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
    build: {
      outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
      emptyOutDir: true,
    },
  };
});
