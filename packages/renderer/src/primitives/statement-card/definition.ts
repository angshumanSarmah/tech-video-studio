import { cardOutline } from '../surface.ts';
import { z } from 'zod';
import { safeAreas, type Theme } from '../../theme/index.ts';
import { idsOf, lineText, PartIdSchema, partList, semanticProp } from '../common-props.ts';
import { lineHeightPx, widestWord, wrappedRows } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const StatementLineSchema = z.strictObject({
  id: PartIdSchema,
  text: lineText(32, 'One large line at display size; wraps rather than shrinking.'),
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

/** Text style of every line: the theme's largest display style; lines wrap, never shrink. */
export const STATEMENT_STYLE = 'headline';

/** Padding inside the card's border: `x` left and right, `y` top and bottom. */
export function statementPadding(theme: Theme): { x: number; y: number } {
  return { x: theme.space.lg + theme.stroke.regular, y: theme.space.xl + theme.stroke.regular };
}

/** The card's full width: the stage less a `space.md` gutter on each side. */
export function statementMaxWidth(theme: Theme): number {
  return safeAreas(theme).stage.width - 2 * theme.space.md;
}

/** Card height at `width`, with every line word-wrapped at the headline size. */
export function statementHeight(props: StatementCardProps, theme: Theme, width: number): number {
  const pad = statementPadding(theme);
  const textWidth = width - 2 * pad.x;
  const rows = props.lines.reduce(
    (sum, line) => sum + wrappedRows(theme, STATEMENT_STYLE, line.text, textWidth),
    0,
  );
  const gaps = (props.lines.length - 1) * theme.space.md;
  return rows * lineHeightPx(theme, STATEMENT_STYLE) + gaps + 2 * pad.y;
}

/**
 * A big moment spans the stage: preferred width is the full stage less gutters. It may narrow to
 * its widest word (lines wrap further, the text never shrinks).
 */
export function statementCardSizeHints(props: StatementCardProps, theme: Theme): SizeHints {
  const pad = statementPadding(theme);
  const preferredWidth = statementMaxWidth(theme);
  const words = props.lines.map((l) => widestWord(theme, STATEMENT_STYLE, l.text));
  const minWidth = Math.min(preferredWidth, Math.max(...words) + 2 * pad.x);
  return {
    minWidth,
    minHeight: statementHeight(props, theme, minWidth),
    preferredWidth,
    preferredHeight: statementHeight(props, theme, preferredWidth),
  };
}

export const statementCardPrimitive = definePrimitive({
  id: 'statement_card',
  family: 'annotation',
  propsSchema: StatementCardPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: statementCardSizeHints,
  outline: (_props, box, theme) => cardOutline(theme, 'neutral', box),
  layer: 'overlay',
  parts: { actions: ['enter', 'exit', 'highlight', 'pulse'], ids: (props) => idsOf(props.lines) },
  description: {
    summary:
      'One to three large `lines` at display size on a card that spans the stage, over the ' +
      'dimmed scene, each line in its own colour meaning. Long lines wrap; the text never ' +
      'shrinks. `enter` fades it in with a slight rise. Lines are parts: `enter` a ' +
      'line on its word to build the statement up, highlight or pulse the one that matters. ' +
      'It is an overlay: everything else on the board dims while it shows.',
    whenToUse:
      'A planted question ("Why not just retry forever?"), a two-line takeaway ' +
      '("Easy: copy the data. Hard: keep it in sync."), a verdict before the next chapter.',
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
