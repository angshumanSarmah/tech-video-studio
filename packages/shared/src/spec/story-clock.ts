import { normalizeNumber, quantityTokens } from '../research/numbers.ts';
import type { StoryClock, StoryClockUnit } from './story.ts';

/**
 * What a story clock's values are. Its `unit` when set; otherwise a count when a label writes the
 * clock's own start or end value as a number ("256 byte values" → "32,000 entries"), since time
 * labels name moments ("ORDER" → "DOORBELL"), never the seconds; else story seconds. Pure.
 */
export function storyClockUnit(
  clock: Pick<StoryClock, 'from' | 'to' | 'unit' | 'startValue' | 'endValue'>,
): StoryClockUnit {
  if (clock.unit) return clock.unit;
  const values = new Set([clock.startValue, clock.endValue]);
  const labelled = [clock.from, clock.to]
    .flatMap(quantityTokens)
    .some((token) => values.has(Number(normalizeNumber(token))));
  return labelled ? 'count' : 'sec';
}
