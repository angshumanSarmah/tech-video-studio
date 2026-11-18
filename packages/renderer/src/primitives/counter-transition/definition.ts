import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { lineText, semanticProp } from '../common-props.ts';
import { formatCount } from '../counter/format.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const CounterTransitionPropsSchema = z.strictObject({
  from: z.number().finite().describe('The number before the change.'),
  to: z.number().finite().describe('The number after the change.'),
  unit: lineText(16, 'Short unit after the new number.').optional(),
  label: lineText(32, 'Caption under the numbers.').optional(),
  fromSemantic: semanticProp('neutral', 'Colour of the old number'),
  toSemantic: semanticProp('focus', 'Colour of the new number'),
  decimals: z.number().int().min(0).max(2).default(0).describe('Digits after the decimal point.'),
});
export type CounterTransitionProps = z.output<typeof CounterTransitionPropsSchema>;

export const TRANSITION_ARROW = '→';

export function counterTransitionSizeHints(props: CounterTransitionProps, theme: Theme): SizeHints {
  const { space } = theme;
  const digits = (n: number) => formatCount(n, theme.numberLocale, props.decimals);
  const numbers = `${digits(props.from)} ${TRANSITION_ARROW} ${digits(props.to)}`;
  const unit = props.unit ? space.sm + approxTextWidth(theme, 'label', props.unit) : 0;
  const label = props.label ? approxTextWidth(theme, 'label', props.label) : 0;
  const numbersWidth = approxTextWidth(theme, 'metric', numbers) + 2 * space.md + unit;
  const width = Math.max(numbersWidth, label) + 2 * space.md;
  const labelHeight = props.label ? space.xs + lineHeightPx(theme, 'label') : 0;
  const height = lineHeightPx(theme, 'metric') + labelHeight + 2 * space.sm;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const counterTransitionPrimitive = definePrimitive({
  id: 'counter_transition',
  family: 'metric',
  propsSchema: CounterTransitionPropsSchema,
  actions: ['enter', 'exit', 'count', 'highlight', 'dim', 'pulse'],
  sizeHints: counterTransitionSizeHints,
  description: {
    summary:
      'A big number changing to another, shown as "10 → 9": the old number in one colour, an ' +
      'arrow, the new number in another. Without a `count` event it shows the change as done. ' +
      'With one, the old number stands alone until the count, then the arrow and the new number ' +
      'come in and the old one fades back.',
    whenToUse:
      'One discrete change the story turns on: a stock of 10 seats dropping to 9, a version ' +
      'going from 1 to 2, a retry count ticking up. The colour change carries the meaning (e.g. ' +
      'neutral to problem).',
    whenNotToUse:
      'A quantity that counts smoothly up or down (use `counter`); a countdown in time; more ' +
      'than one change at once.',
  },
  example: {
    props: { from: 10, to: 9, unit: '<example-unit>', fromSemantic: 'ok', toSemantic: 'problem' },
  },
});
