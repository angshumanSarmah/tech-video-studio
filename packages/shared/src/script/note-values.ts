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

/** Which research numbers hold which values, for counting numbers by id, not by value. */
export interface NumberIndex {
  /** Value key → the `num-*` ids whose value states it, in notes order. */
  readonly idsByKey: ReadonlyMap<string, readonly string[]>;
  /** `num-*` id → the value keys its value states ("one, one and three" → 1 and 3). */
  readonly keysById: ReadonlyMap<string, ReadonlySet<string>>;
}

export function numberIndex(notes: ResearchNotes): NumberIndex {
  const idsByKey = new Map<string, string[]>();
  const keysById = new Map<string, Set<string>>();
  for (const n of notes.numbers) {
    const keys = new Set(keysOf(n.value));
    keysById.set(n.id, keys);
    for (const key of keys) idsByKey.set(key, [...(idsByKey.get(key) ?? []), n.id]);
  }
  return { idsByKey, keysById };
}

/**
 * The research number a value belongs to in a text: of the numbers that state it, the one that
 * covers most of the text's values (so "one, one, three" all count as the number "one, one and
 * three"), first in notes order on a tie; `value:<key>` when no research number states it.
 */
export function researchNumberOf(
  key: string,
  textKeys: ReadonlySet<string>,
  index: NumberIndex,
): string {
  const ids = index.idsByKey.get(key) ?? [];
  const cover = (id: string) =>
    [...(index.keysById.get(id) ?? [])].filter((k) => textKeys.has(k)).length;
  const best = ids.reduce<string | undefined>(
    (top, id) => (top === undefined || cover(id) > cover(top) ? id : top),
    undefined,
  );
  return best ?? `value:${key}`;
}
