import { defineConfig } from 'vitest/config';

/**
 * Visual regression (`pnpm --filter @explainer-studio/studio test:visual`): renders the golden
 * fixtures with Remotion and compares them with saved images. Kept out of `pnpm test` because it
 * bundles the renderer and drives Chrome (minutes, not seconds) and its saved images are
 * machine-specific. The pure pieces (`scripts/golden/*.test.ts`) run in the normal suite.
 */
export default defineConfig({
  test: {
    name: 'visual',
    environment: 'node',
    include: ['scripts/golden/**/*.visual.ts'],
    testTimeout: 10 * 60_000,
    // One file, run in order: both fixtures share one Remotion bundle.
    fileParallelism: false,
  },
});
