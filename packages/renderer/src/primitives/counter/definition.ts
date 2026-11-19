import { z } from 'zod';
import { SEMANTIC_COLOURS, type Theme } from '../../theme/index.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';
import { formatCount } from './format.ts';

export const CounterPropsSchema = z.strictObject({
  value: z.number().finite().describe('The number shown once any count has finished.'),
  from: z
    .number()
    .finite()
    .optional()
    .describe('Where a `count` starts (default 0). Shown until the count begins.'),
  unit: z.string().trim().min(1).max(16).optional().describe('Short unit after the number.'),
  label: z.string().trim().min(1).max(32).optional().describe('Caption under the number.'),
  semantic: z
    .enum(SEMANTIC_COLOURS)
    .default('focus')
    .describe('Colour of the number: neutral, focus, ok, problem or concept.'),
  decimals: z.number().int().min(0).max(2).default(0).describe('Digits after the decimal point.'),
  ticking: z
    .boolean()
    .default(false)
    .describe(
      'Count on narration time: the count runs from its word until the `reject` (else the exit ' +
        'or the end of the beat), like a clock. Without it a count takes under a second.',
    ),
});
export type CounterProps = z.output<typeof CounterPropsSchema>;

export function counterSizeHints(props: CounterProps, theme: Theme): SizeHints {
  const { space } = theme;
  const from = props.from ?? 0;
  const widest = Math.max(Math.abs(props.value), Math.abs(from));
  const signed = Math.min(props.value, from) < 0 ? -widest : widest;
  const digits = formatCount(signed, theme.numberLocale, props.decimals);
  const unit = props.unit ? space.sm + approxTextWidth(theme, 'label', props.unit) : 0;
  const label = props.label ? approxTextWidth(theme, 'label', props.label) : 0;
  const width = Math.max(approxTextWidth(theme, 'metric', digits) + unit, label) + 2 * space.md;
  const labelHeight = props.label ? space.xs + lineHeightPx(theme, 'label') : 0;
  const height = lineHeightPx(theme, 'metric') + labelHeight + 2 * space.sm;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const counterPrimitive = definePrimitive({
  id: 'counter',
  family: 'metric',
  propsSchema: CounterPropsSchema,
  actions: ['enter', 'exit', 'count', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: counterSizeHints,
  description: {
    summary:
      'A big number with an optional unit and caption. Without a `count` event it shows `value`. ' +
      'With one, it shows `from` (default 0) until the count begins, then counts up or down to ' +
      '`value`, so the viewer watches a quantity grow or drain. With `ticking` the count runs on ' +
      'narration time and lands on `value` exactly at the `reject` (an outage clock that stops ' +
      'when the outage ends). `reject` turns the number red with a shake.',
    whenToUse:
      'One quantity that matters to the story: requests per second, tokens left, queue length, ' +
      'latency, how long an outage lasted. Use `count` when the change itself is the point.',
    whenNotToUse:
      'A word or status instead of a quantity (use `tag`); a countdown in time; several numbers ' +
      'at once (one counter per number, and only the ones the story needs).',
  },
  example: {
    props: { value: 10000, from: 0, unit: '<example-unit>', label: '<example-caption>' },
  },
});
