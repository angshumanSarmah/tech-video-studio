import type { ResearchNotes } from '../research/notes.ts';
import { numberKey, numberMentions } from './number-mentions.ts';

/**
 * The research notes' numbers as comparable values (`numberKey`), for the checks that compare
 * spoken or written numbers by value: the Scriptwriter's and the Director's density cap. Pure.
 */

const keysOf = (text: string) => numberMentions(text).map((m) => numberKey(m.value));

/** Every `numbers[].value` the notes give. */
export function numberValueKeys(notes: ResearchNotes): Set<string> {
  return new Set(notes.numbers.flatMap((n) => keysOf(n.value)));
}

function dateTexts(notes: ResearchNotes): string[] {
  return [
    ...notes.numbers.map((n) => n.asOf ?? ''),
    ...notes.failureModes.map((f) => f.incident?.date ?? ''),
  ];
}

/** The values the notes state: every number's value, plus the dates they give. */
export function researchValueKeys(notes: ResearchNotes): Set<string> {
  return new Set([...numberValueKeys(notes), ...dateTexts(notes).flatMap(keysOf)]);
}

/** Values the notes give only as dates (an `asOf`, an incident date), never as a number. */
export function dateOnlyKeys(notes: ResearchNotes): Set<string> {
  const numbers = numberValueKeys(notes);
  return new Set(
    dateTexts(notes)
      .flatMap(keysOf)
      .filter((k) => !numbers.has(k)),
  );
}
