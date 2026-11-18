import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'server/index': 'src/server/index.ts',
    'worker/index': 'src/worker/index.ts',
    'db/migrate-cli': 'src/core/db/migrate-cli.ts',
  },
  outDir: 'dist/node',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TS source, so they must be bundled rather than left external.
  noExternal: [/^@explainer-studio\//],
});
