import { fileURLToPath } from 'node:url';

/**
 * Test and script helpers for the Director (`direct.test.ts`, `director:fixture`). Its input is
 * the Researcher's rate-limiter fixture (`researcher/testing.ts`): sources ingested, then the
 * recorded Researcher answer replayed. Not imported by any entrypoint.
 */

/** Director answers for the rate-limiter notes (`loadDryRunFixtures`). */
export const DIRECTOR_RESPONSES_DIR = fileURLToPath(
  new URL('./fixtures/rate-limiter/responses', import.meta.url),
);
