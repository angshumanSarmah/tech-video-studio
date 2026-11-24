import { EventTargetSchema, SpecIdSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { SEMANTIC_COLOURS, type SemanticColour } from '../theme/index.ts';
import { PIN_SIDES, type ElementRef } from './types.ts';

/** Prop schemas shared by several primitives, so their LLM-facing wording stays the same. */

export function semanticProp(fallback: SemanticColour, what = 'Colour meaning') {
  return z
    .enum(SEMANTIC_COLOURS)
    .default(fallback)
    .describe(`${what}: neutral, focus, ok, problem or concept.`);
}

/**
 * Schema metadata the screen checks read (`catalog/schema-leaves.ts`): which props hold asset
 * ids, which numbers are drawn on screen (and in what unit), and which strings are not plain
 * screen text. It also reaches the catalogue's JSON Schema, so the model sees it.
 */
export const AssetIdSchema = SpecIdSchema.describe(
  'Asset id from the asset library (an unknown id is drawn as a placeholder and reported).',
).meta({ assetId: true });

/** Units a displayed number can be in; screen checks convert research values to them. */
export type DisplayUnit = 'sec';

/** Marks a number prop as drawn on screen, so it must be a research value (`unit` converts). */
export function displayNumber<T extends z.ZodType>(schema: T, unit?: DisplayUnit): T {
  return schema.meta({ displayNumber: unit ? { unit } : {} });
}

/** How far a stepping number may sit from a research value (a token spent, one by one). */
export const MAX_DISPLAY_STEP = 3;

/**
 * Marks a counter's number: drawn on screen like `displayNumber`, and it may also step a research
 * value by 1 to `MAX_DISPLAY_STEP` (100 tokens, then 99 after one is spent).
 */
export function steppingNumber<T extends z.ZodType>(schema: T): T {
  return schema.meta({ displayNumber: { steps: MAX_DISPLAY_STEP } });
}

/** Marks a string prop as not plain screen text (LaTeX), so text checks skip it. */
export function notScreenText<T extends z.ZodType>(schema: T): T {
  return schema.meta({ screenText: false });
}

/** U+2423 OPEN BOX: how a space at the edge of screen text is drawn, so the viewer sees it. */
export const VISIBLE_SPACE = '\u2423';

/**
 * Text with its edge spaces made visible: each leading or trailing space becomes `VISIBLE_SPACE`
 * (" Paris" -> "␣Paris"); other edge whitespace is trimmed, and text that is only whitespace
 * becomes "". Applied only where the beat's script has the same text with that space
 * (`scene/edge-spaces.ts`); screen text is otherwise trimmed.
 */
export function showEdgeSpaces(text: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [, lead = '', core = '', trail = ''] = match ?? [];
  if (core === '') return '';
  const spaces = (edge: string) => VISIBLE_SPACE.repeat([...edge].filter((c) => c === ' ').length);
  return `${spaces(lead)}${core}${spaces(trail)}`;
}

/** A string drawn on screen: trimmed (edge spaces the script means come in as ␣ beforehand). */
export function screenString() {
  return z.string().trim();
}

/** A short single line of text: trimmed, non-empty, no line breaks. */
export function lineText(max: number, description: string) {
  return screenString()
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

/** Several element ids in this beat, each at most once. */
export function elementRefList({ min, max }: { min: number; max: number }, description: string) {
  return z
    .array(SpecIdSchema)
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Each element id at most once.')
    .describe(description);
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

/**
 * Optional `pin`: keeps a small element (tag, counter, timer, callout) on one side of another
 * element, or on a connector's midpoint, wherever the layout puts it.
 */
export const PinSchema = z
  .strictObject({
    // Any target id, `<instance>/<id>` included, so the registry check can say why an instance
    // or its inner elements cannot host a pin (and name the hosts) instead of a bare slug error.
    to: EventTargetSchema.describe(
      'Id of an element of this board to pin to (a connector, for middle); never a pattern instance or an element inside one.',
    ),
    side: z
      .enum(PIN_SIDES)
      .default('top')
      .describe(
        'Side of that element: top, bottom, left, right, or middle (a connector midpoint).',
      ),
  })
  .describe('Optional: pin this element to another one so it stays attached to it.');
export type Pin = z.output<typeof PinSchema>;

/** The primitives a `middle` pin may point to (a line's midpoint). */
export const MIDDLE_PIN_HOSTS: readonly string[] = ['connector'];

/** The element ref a `pin` prop declares (none without a pin). */
export function pinRefs(pin: Pin | undefined): ElementRef[] {
  if (!pin) return [];
  const middle = pin.side === 'middle' ? { primitives: [...MIDDLE_PIN_HOSTS] } : {};
  return [{ path: ['pin', 'to'], id: pin.to, pin: pin.side, ...middle }];
}
