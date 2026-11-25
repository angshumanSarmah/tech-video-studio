import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';
import {
  AvoidNameKindSchema,
  AvoidNameSchema,
  MAX_NAMES_TO_AVOID,
  type AvoidName,
} from './record.ts';

/**
 * `seed/references/names-to-avoid.json` (P1C.11): per seed reference (its slug), the original's
 * names (brands, the creator, the incident's organisation, titles, catchphrases). Kept out of the
 * breakdown files, which stay structure-only; only code reads it. An entry may be a slot still to
 * fill: an empty `text` with a `todo` saying what goes there. Seeding skips slots; fill `text`
 * (the `todo` may stay) and the entry is a name.
 */

/** A name, optionally with the `todo` its slot had. */
const FilledNameSchema = AvoidNameSchema.extend({ todo: z.string().optional() });

/** A slot to fill: no name yet, and what belongs there. */
const NameSlotSchema = z.strictObject({
  text: z.literal(''),
  kind: AvoidNameKindSchema,
  todo: z.string().trim().min(1),
});

export const NamesToAvoidEntrySchema = z.union([NameSlotSchema, FilledNameSchema]);
export type NamesToAvoidEntry = z.infer<typeof NamesToAvoidEntrySchema>;

export const NamesToAvoidFileSchema = z.record(
  SpecIdSchema,
  z.array(NamesToAvoidEntrySchema).max(MAX_NAMES_TO_AVOID),
);
export type NamesToAvoidFile = z.infer<typeof NamesToAvoidFileSchema>;

/** A slug's names, slots left out. */
export function namesToAvoidOf(entries: readonly NamesToAvoidEntry[] = []): AvoidName[] {
  return entries.flatMap((e) => (e.text === '' ? [] : [{ text: e.text, kind: e.kind }]));
}

/** The slots still empty, per slug, with what each is for. */
export function openNameSlots(file: NamesToAvoidFile): { slug: string; todo: string }[] {
  return Object.entries(file).flatMap(([slug, entries]) =>
    entries.flatMap((e) =>
      e.text === '' && 'todo' in e && e.todo ? [{ slug, todo: e.todo }] : [],
    ),
  );
}
