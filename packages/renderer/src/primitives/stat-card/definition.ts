import { ON_SCREEN_TEXT_LIMITS } from '@explainer-studio/shared';
import { cardOutline } from '../surface.ts';
import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { lineText, semanticProp } from '../common-props.ts';
import { textWidth } from '../../fonts/measure-text.ts';
import { lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const StatCardPropsSchema = z.strictObject({
  value: lineText(ON_SCREEN_TEXT_LIMITS.statValue, 'The figure as displayed, units included.'),
  label: lineText(ON_SCREEN_TEXT_LIMITS.statLabel, 'What the figure measures.'),
  source: lineText(60, 'Where the figure comes from, shown as a footnote. Required.'),
  semantic: semanticProp('focus', 'Colour of the value'),
});
export type StatCardProps = z.output<typeof StatCardPropsSchema>;

export const SOURCE_PREFIX = 'Source: ';

/**
 * Sized from the real glyph advances (`textWidth`), not the average advance: the figure is drawn
 * at the metric size, where the average overstates mixed text by a third or more ("about 1.3":
 * 597 px estimated, 411 px drawn), which made the card far wider than what it shows.
 */
export function statCardSizeHints(props: StatCardProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const source = props.source ? [textWidth(theme, 'footnote', SOURCE_PREFIX + props.source)] : [];
  const text = Math.max(
    textWidth(theme, 'metric', props.value),
    textWidth(theme, 'label', props.label),
    ...source,
  );
  const width = text + 2 * (space.lg + stroke.regular);
  const sourceLine = props.source ? space.md + lineHeightPx(theme, 'footnote') : 0;
  const height =
    lineHeightPx(theme, 'metric') +
    space.xs +
    lineHeightPx(theme, 'label') +
    sourceLine +
    2 * (space.md + stroke.regular);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const statCardPrimitive = definePrimitive({
  id: 'stat_card',
  family: 'metric',
  propsSchema: StatCardPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: statCardSizeHints,
  // The beat's footnote already names the source: drop the card's own line (`source: ''`).
  besideFootnote: (props, footnote) =>
    props.source.trim() === footnote.trim() ? { ...props, source: '' } : props,
  outline: (props, box, theme) => cardOutline(theme, props.semantic, box),
  description: {
    summary:
      'A card with one big figure, a label under it, and a small source footnote. The figure is ' +
      'text, so units and formatting stay as written ("10k/s", "₹2,000 Cr", "99.9%").',
    whenToUse:
      'A cited real-world number that makes the problem concrete: traffic at peak, money lost, ' +
      'a benchmark. Every figure from research needs its source.',
    whenNotToUse:
      'A number that animates or changes (use `counter` or `counter_transition`); an ' +
      'illustrative number with no source (use `counter`); a label or status (use `tag`).',
  },
  example: {
    props: {
      value: '<example-n>',
      label: '<example-label>',
      source: '<example-source>',
    },
  },
});
