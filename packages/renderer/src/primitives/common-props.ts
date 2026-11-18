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
