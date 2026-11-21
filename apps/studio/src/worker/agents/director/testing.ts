import { fixtureResponsesDir } from '../fixture-topics.ts';

/**
 * Test and script helpers for the Director (`direct.test.ts`, `director:fixture`). Its input is
 * the Researcher's rate-limiter fixture (`researcher/testing.ts`): sources ingested, then the
 * recorded Researcher answer replayed. Not imported by any entrypoint.
 */

/** Director answers for the rate-limiter notes (`loadDryRunFixtures`). */
export const DIRECTOR_RESPONSES_DIR = fixtureResponsesDir('director', 'rate-limiter');
