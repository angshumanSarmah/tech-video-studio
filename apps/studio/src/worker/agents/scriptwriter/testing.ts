import { fileURLToPath } from 'node:url';

/**
 * Test and script helpers for the Scriptwriter (`script.test.ts`, `scriptwriter:fixture`). Its
 * input is the Director's rate-limiter fixture (`director/testing.ts`), replayed after the
 * Researcher's. Not imported by any entrypoint.
 */

/**
 * Scriptwriter answers for the rate-limiter plan (`loadDryRunFixtures`). Hand-written until
 * recorded with `scriptwriter:fixture --record`.
 */
export const SCRIPTWRITER_RESPONSES_DIR = fileURLToPath(
  new URL('./fixtures/rate-limiter/responses', import.meta.url),
);
