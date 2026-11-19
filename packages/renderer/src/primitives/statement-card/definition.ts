import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { idsOf, lineText, PartIdSchema, partList, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const StatementLineSchema = z.strictObject({
  id: PartIdSchema,
  text: lineText(32, 'One large line; wraps if the stage is narrow.'),
  semantic: semanticProp('neutral', 'Colour of this line'),
});

export const StatementCardPropsSchema = z.strictObject({
  lines: partList(
    StatementLineSchema,
    { min: 1, max: 3 },
    'One to three lines, top to bottom, each with its own colour meaning.',
  ),
});
export type StatementCardProps = z.output<typeof StatementCardPropsSchema>;

/** Widest the card grows (the stage is 936 px wide); longer lines wrap. */
export const STATEMENT_MAX_WIDTH = 860;
const MIN_WIDTH = 480;

/** Rows each line takes at the card's text width. */
export function statementRows(
  props: StatementCardProps,
  theme: Theme,
  textWidth: number,
): number[] {
  return props.lines.map((line) =>
    Math.max(1, Math.ceil(approxTextWidth(theme, 'headline', line.text) / textWidth)),
  );
}

export function statementCardSizeHints(props: StatementCardProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const pad = space.xl + stroke.regular;
  const widest = Math.max(...props.lines.map((l) => approxTextWidth(theme, 'headline', l.text)));
  const width = Math.min(STATEMENT_MAX_WIDTH, Math.max(MIN_WIDTH, widest + 2 * pad));
  const rows = statementRows(props, theme, width - 2 * pad).reduce((a, b) => a + b, 0);
  const gaps = (props.lines.length - 1) * space.md;
  const height = rows * lineHeightPx(theme, 'headline') + gaps + 2 * pad;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const statementCardPrimitive = definePrimitive({
  id: 'statement_card',
  family: 'annotation',
  propsSchema: StatementCardPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: statementCardSizeHints,
  layer: 'overlay',
  parts: { actions: ['enter', 'exit', 'highlight', 'pulse'], ids: (props) => idsOf(props.lines) },
  description: {
    summary:
      'One to three large `lines` on a card over the dimmed scene, each line in its own ' +
      'colour meaning. `enter` fades it in with a slight rise. Lines are parts: `enter` a ' +
      'line on its word to build the statement up, highlight or pulse the one that matters. ' +
      'It is an overlay: everything else on the board dims while it shows.',
    whenToUse:
      'A planted question ("Why not just pick the nearest rider?"), a two-line takeaway ' +
      '("Easy: find riders. Hard: pick the right one."), a verdict before the next chapter.',
    whenNotToUse:
      'A label next to a diagram part (use `tag` or `callout`); the beat headline (that is the ' +
      'HUD headline); a detail view with diagram parts in it (use `inset_panel`). Show at most ' +
      'one overlay at a time.',
  },
  example: {
    props: {
      lines: [
        { id: 'easy', text: '<example-easy-part>', semantic: 'ok' },
        { id: 'hard', text: '<example-hard-part>', semantic: 'problem' },
      ],
    },
  },
});
