import { fixtureResponsesDir } from '../fixture-topics.ts';

/**
 * Test and script helpers for the Director (`direct.test.ts`, `director:fixture`). Its input is
 * the Researcher's rate-limiter fixture (`researcher/testing.ts`): sources ingested, then the
 * recorded Researcher answer replayed. Not imported by any entrypoint.
 */

/** Director answers for the rate-limiter notes (`loadDryRunFixtures`). */
export const DIRECTOR_RESPONSES_DIR = fixtureResponsesDir('director', 'rate-limiter');

/**
 * The rate-limiter recording (`director@v3`) predates `mixed_system_numbers`: beats b2-b5 cite
 * the field guide's and the library README's numbers next to Larkspur Pay's incident. Until it
 * is re-recorded, a replay ends with the repair that check asks for: those beats set
 * `exampleNumbers`. A recording that already sets it is replayed as is.
 * TODO(re-record): drop with the next `director:fixture --topic rate-limiter --record`.
 */
export const EXAMPLE_BEATS_UNTIL_RE_RECORDED = ['b2', 'b3', 'b4', 'b5'];

export function withExampleNumbersRepair<T extends { content?: string | null }>(
  responses: readonly T[],
): (T | { content: string })[] {
  const plan = JSON.parse(responses.at(-1)!.content!) as {
    story: { beats: { id: string; exampleNumbers?: boolean }[] };
  };
  if (plan.story.beats.some((b) => b.exampleNumbers)) return [...responses];
  for (const beat of plan.story.beats) {
    if (EXAMPLE_BEATS_UNTIL_RE_RECORDED.includes(beat.id)) beat.exampleNumbers = true;
  }
  return [...responses, { content: JSON.stringify(plan) }];
}
