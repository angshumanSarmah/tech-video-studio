/**
 * An invented, deliberately long source for the source token budget test: an intro, then many
 * sections that have nothing to do with rate limiting, with a few relevant ones spread through
 * them. Built in code so the repo does not carry a large file. Deterministic.
 */

/** Section numbers (1-based) that are about the topic. */
export const RELEVANT_SECTIONS = [7, 19, 31] as const;
export const OVERSIZED_SECTION_COUNT = 40;

/** Marker text in every relevant section, for assertions. */
export const RELEVANT_MARKER = 'token bucket refill';

const FILLER =
  'The facilities team rotated the meeting rooms again this quarter. The plants on the third ' +
  'floor were moved closer to the windows, the kitchen got a second kettle, and the notice board ' +
  'by the lifts now lists the cycling club rides. None of this changed how the office works, but ' +
  'people noticed and wrote about it at length in the internal newsletter, paragraph after ' +
  'paragraph, with photos of the new chairs and a long debate about the coffee rota.';

const RELEVANT =
  `How the gateway rate limiter works: a ${RELEVANT_MARKER} cycle runs on every request. The ` +
  'limiter reads the token count for the key from the shared store, adds the tokens earned since ' +
  'the last refill, and takes one token if any is left. A rate limiter that keeps its bucket in ' +
  'the shared store gives every gateway node the same view of the limit. When the bucket is ' +
  'empty, the gateway answers with a Retry-After header and the client waits.';

function section(n: number): string {
  const relevant = (RELEVANT_SECTIONS as readonly number[]).includes(n);
  const body = relevant ? RELEVANT : FILLER;
  return `## Section ${n}\n\n${body}\n\n${body}`;
}

export function buildOversizedSource(): string {
  const intro =
    '# Notes from the platform team\n\n_Invented document written for the Explainer Studio test ' +
    'fixtures._\n\nThis is a long collection of team notes. Most of it is about the office.';
  const sections = Array.from({ length: OVERSIZED_SECTION_COUNT }, (_, i) => section(i + 1));
  return `${[intro, ...sections].join('\n\n')}\n`;
}
