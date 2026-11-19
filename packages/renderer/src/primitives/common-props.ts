import { SpecIdSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { SEMANTIC_COLOURS, type SemanticColour } from '../theme/index.ts';

/** Prop schemas shared by several primitives, so their LLM-facing wording stays the same. */

export function semanticProp(fallback: SemanticColour, what = 'Colour meaning') {
  return z
    .enum(SEMANTIC_COLOURS)
    .default(fallback)
    .describe(`${what}: neutral, focus, ok, problem or concept.`);
}

export const AssetIdSchema = SpecIdSchema.describe(
  'Asset id from the asset library (an unknown id is drawn as a placeholder and reported).',
);

/** A short single line of text: trimmed, non-empty, no line breaks. */
export function lineText(max: number, description: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r]*$/, 'One line, without line breaks.')
    .describe(description);
}

/** Id of a named part (slot, cell, zone); events address it with `params.parts`. */
export const PartIdSchema = SpecIdSchema.describe(
  'Part id, unique in this element; events act on it with params.parts.',
);

/** Id of another element in the beat that this one points to (checked against the beat). */
export function elementRefProp(description: string) {
  return SpecIdSchema.describe(description);
}

/** A list of parts whose `id`s are unique within the element. */
export function partList<T extends z.ZodType<{ id: string }>>(
  item: T,
  { min, max }: { min: number; max: number },
  description: string,
) {
  return z
    .array(item)
    .min(min)
    .max(max)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach(({ id }, i) => {
        if (seen.has(id)) {
          ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `Duplicate part id "${id}".` });
        }
        seen.add(id);
      });
    })
    .describe(description);
}

/** The ids of a part list, for `parts.ids`. */
export const idsOf = (items: readonly { id: string }[]): string[] => items.map((i) => i.id);
