import { z } from 'zod';
import { SEMANTIC_COLOURS, type Theme } from '../../theme/index.ts';
import { lineText as lineTextProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';
import { dataLines, lineText } from './lines.ts';

export const DATA_BLOCK_MAX_FIELDS = 6;

export const DataFieldSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,19}$/, 'A short field name: letters, digits, "_", "-", ".".')
    .describe('Field name, as it would appear in the data.'),
  value: z
    .union([z.string().max(28), z.number().finite(), z.boolean(), z.null()])
    .describe('Field value: a short string, a number, true/false or null.'),
  semantic: z
    .enum(SEMANTIC_COLOURS)
    .optional()
    .describe('Colours the value and tints its row: neutral, focus, ok, problem or concept.'),
});
export type DataField = z.output<typeof DataFieldSchema>;

export const DataBlockPropsSchema = z.strictObject({
  title: lineTextProp(24, 'Optional name above the block, e.g. the record type.').optional(),
  fields: z
    .array(DataFieldSchema)
    .min(1)
    .max(DATA_BLOCK_MAX_FIELDS)
    .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
      message: 'Field keys must be unique.',
    })
    .describe('The key/value pairs, in display order.'),
});
export type DataBlockProps = z.output<typeof DataBlockPropsSchema>;

export function dataBlockSizeHints(props: DataBlockProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const lines = dataLines(props.fields).map(lineText);
  const widest = Math.max(
    ...lines.map((line) => approxTextWidth(theme, 'data', line)),
    props.title ? approxTextWidth(theme, 'label', props.title) : 0,
  );
  const title = props.title ? lineHeightPx(theme, 'label') + space.xs : 0;
  const width = widest + 2 * (space.lg + stroke.regular);
  const height =
    title + (lines.length + 2) * lineHeightPx(theme, 'data') + 2 * (space.md + stroke.regular);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const dataBlockPrimitive = definePrimitive({
  id: 'data_block',
  family: 'data',
  propsSchema: DataBlockPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: dataBlockSizeHints,
  description: {
    summary:
      'A JSON-like block of key/value pairs on a card, with an optional title. On `enter` it ' +
      'types in one field at a time (about a third of a second each); without `enter` all ' +
      'fields show at once. A field can colour its value by meaning.',
    whenToUse:
      'Showing what a thing looks like as data: a booking, a cache entry, a message on a ' +
      'queue, the record a real object becomes. Up to 6 short fields.',
    whenNotToUse:
      'Code or logic (this is data only); a single command (use `command_bubble`); long text, ' +
      'nested objects or lists; a single number (use `counter`).',
  },
  example: {
    props: {
      title: '<example-record>',
      fields: [
        { key: 'example_key', value: '<example-value>' },
        { key: 'example_state', value: '<example-state>', semantic: 'ok' },
      ],
    },
  },
});
