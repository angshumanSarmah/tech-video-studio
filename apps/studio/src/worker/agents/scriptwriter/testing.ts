import { fixtureResponsesDir } from '../fixture-topics.ts';

/**
 * Test and script helpers for the Scriptwriter (`script.test.ts`, `scriptwriter:fixture`). Its
 * input is the Director's rate-limiter fixture (`director/testing.ts`), replayed after the
 * Researcher's. Not imported by any entrypoint.
 */

/**
 * Scriptwriter answers for the rate-limiter plan (`loadDryRunFixtures`). Hand-written until
 * recorded with `scriptwriter:fixture --record`.
 */
export const SCRIPTWRITER_RESPONSES_DIR = fixtureResponsesDir('scriptwriter', 'rate-limiter');

/**
 * The rate-limiter recording (`scriptwriter@v5`) was written for a plan without
 * `exampleNumbers`. Once the Director repair (`withExampleNumbersRepair`) marks b2-b5, its
 * example numbers need a label (`example_not_labelled`): this is that repair, written by hand,
 * each narration within its budget and changed only where the label goes. It applies only while
 * the recording holds exactly these narrations.
 * TODO(re-record): drop with the next `scriptwriter:fixture --topic rate-limiter --record`.
 */
const EXAMPLE_LABELS: Readonly<Record<string, { recorded: string; labelled: string }>> = {
  b2: {
    recorded:
      'So a fixed window counts requests per minute and resets. A client can spend its whole quota around the reset: two times the limit.',
    labelled:
      'So a fixed window counts requests per minute and resets. Say a client spends its whole quota around the reset: two times the limit.',
  },
  b3: {
    recorded:
      'Instead, a token bucket holds a pile of passes, capacity one hundred. It refills ten a second. But why share one bucket across gateways?',
    labelled:
      'Instead, a token bucket holds a pile of passes, say one hundred. It refills ten a second. But why share one bucket across gateways?',
  },
  b4: {
    recorded:
      'A shared store holds one bucket for every gateway. Otherwise twenty-four nodes keep their own. A caller gets twenty-four times its limit. Read, spend and write must be one step.',
    labelled:
      'A shared store holds one bucket for every gateway. Say twenty-four nodes kept their own. A caller would get twenty-four times its limit. Read, spend and write must be one step.',
  },
  b5: {
    recorded:
      'The catch: every request waits on that store, zero point four milliseconds at the median. Over fifty milliseconds, the call counts as a store failure.',
    labelled:
      'The catch: every request waits on that store, typically zero point four milliseconds. Over fifty milliseconds, the call counts as a store failure.',
  },
};

export function withExampleLabelRepair<T extends { content?: string | null }>(
  responses: readonly T[],
): (T | { content: string })[] {
  const script = JSON.parse(responses.at(-1)!.content!) as {
    script: { beatId: string; narration: string }[];
  };
  let changed = false;
  for (const beat of script.script) {
    const label = EXAMPLE_LABELS[beat.beatId];
    if (label && beat.narration === label.recorded) {
      beat.narration = label.labelled;
      changed = true;
    }
  }
  return changed ? [...responses, { content: JSON.stringify(script) }] : [...responses];
}
