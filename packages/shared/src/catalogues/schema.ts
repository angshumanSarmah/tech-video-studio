import { z } from 'zod';

/**
 * Building blocks for the story catalogues (topic classes, narrative devices, layout modes,
 * metaphor worlds): versioned data files whose text is LLM-facing. Each catalogue lists its ids
 * once (`as const`), its entry schema takes `id` from that list, and `defineCatalogue` validates
 * the file when it loads, so a bad entry fails at import, in every process and test.
 */

/** One line of LLM-facing text: trimmed, no line breaks, short enough for a compact prompt. */
export const CatalogueTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\n\r]*$/, 'Keep catalogue text on one line.');

/** The three lines every described entry carries, as primitives and patterns do. */
export const DescribedFieldsSchema = z.strictObject({
  /** Human name, shown next to the id. */
  name: CatalogueTextSchema,
  summary: CatalogueTextSchema,
  whenToUse: CatalogueTextSchema,
  whenNotToUse: CatalogueTextSchema,
});

/** A list of ids from a closed set, each at most once. */
export function uniqueIds<T extends z.ZodType<string>>(id: T) {
  return z
    .array(id)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'List each id once.');
}

/**
 * A versioned catalogue whose entries are exactly `ids`, in that order (the order the prompt
 * block renders, so it stays stable). Bump `version` whenever an entry's text or fields change.
 */
export function catalogueSchema<Entry extends z.ZodType<{ id: string }>>(
  id: string,
  ids: readonly string[],
  entry: Entry,
) {
  return z
    .strictObject({
      id: z.literal(id),
      version: z.number().int().positive(),
      entries: z.array(entry),
    })
    .superRefine((catalogue, ctx) => {
      const actual = catalogue.entries.map((e) => e.id);
      if (actual.join('\n') === ids.join('\n')) return;
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: `Entries must be exactly these ids, in order: ${ids.join(', ')}. Got: ${actual.join(', ')}.`,
      });
    });
}

/** Validates a catalogue at module load and returns it as written (no defaults are applied). */
export function defineCatalogue<S extends z.ZodType>(schema: S, data: z.input<S>): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new Error(`Invalid catalogue: ${z.prettifyError(result.error)}`);
}

/** "id@vN", as the prompt block header lists it. */
export function catalogueVersionTag(catalogue: { id: string; version: number }): string {
  return `${catalogue.id}@v${catalogue.version}`;
}
