import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { idsOf, lineText, PartIdSchema, partList, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { TIMER_MAX_SEC } from '../timer-ring/definition.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const TimeSegmentSchema = z.strictObject({
  id: PartIdSchema,
  label: lineText(8, 'Short name of the step, e.g. BUILD or TEST.'),
  sec: z.number().int().min(1).max(TIMER_MAX_SEC).describe('How long the step takes, in seconds.'),
  semantic: semanticProp('concept', 'Segment colour'),
});

export const SegmentedTimeBarPropsSchema = z.strictObject({
  segments: partList(
    TimeSegmentSchema,
    { min: 1, max: 5 },
    'Steps in order, left to right (1 to 5).',
  ),
  budgetSec: z
    .number()
    .int()
    .min(1)
    .max(TIMER_MAX_SEC)
    .optional()
    .describe('Optional time budget: a marker on the bar; time past it is drawn red.'),
  label: lineText(24, 'Optional caption: what the time is for, e.g. COMMIT TO DEPLOY.').optional(),
});
export type SegmentedTimeBarProps = z.output<typeof SegmentedTimeBarPropsSchema>;

/** Width the bar aims for: most of the stage. */
const PREFERRED_WIDTH = 840;

export type TimeBarMetrics = {
  /** Smallest width of each segment, so its label and time fit. */
  mins: number[];
  bar: number;
  header: number;
  footer: number;
};

export function timeBarMetrics(props: SegmentedTimeBarProps, theme: Theme): TimeBarMetrics {
  const pad = 2 * theme.space.xs;
  return {
    mins: props.segments.map(
      (s) =>
        Math.max(approxTextWidth(theme, 'label', s.label), approxTextWidth(theme, 'hud', '00:00')) +
        pad,
    ),
    bar: theme.space.xl + theme.space.sm,
    header: lineHeightPx(theme, 'title') + theme.space.sm,
    footer: lineHeightPx(theme, 'hud') + theme.space.sm,
  };
}

export function segmentedTimeBarSizeHints(props: SegmentedTimeBarProps, theme: Theme): SizeHints {
  const m = timeBarMetrics(props, theme);
  const total = props.segments.reduce((sum, s) => sum + s.sec, 0);
  // An unused budget adds an empty stretch at the end; give it some room.
  const spare = props.budgetSec && props.budgetSec > total ? theme.space.xl : 0;
  const min = m.mins.reduce((a, b) => a + b, 0) + spare;
  const height = m.header + m.bar + m.footer;
  return {
    minWidth: min,
    minHeight: height,
    preferredWidth: Math.max(min, PREFERRED_WIDTH),
    preferredHeight: height,
  };
}

export const segmentedTimeBarPrimitive = definePrimitive({
  id: 'segmented_time_bar',
  family: 'metric',
  propsSchema: SegmentedTimeBarPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: segmentedTimeBarSizeHints,
  parts: {
    actions: ['highlight', 'pulse', 'reject', 'dim'],
    ids: (props) => idsOf(props.segments),
  },
  description: {
    summary:
      'A stacked bar splitting a time budget into steps (BUILD | TEST), each segment as wide as ' +
      'its time with its mm:ss under it, and the total at the top right. With `budgetSec`, a ' +
      'marker shows the budget and any time past it turns red. `enter` fills the segments left ' +
      'to right; segments are parts: highlight the step being discussed, reject the one that ' +
      'blows the budget.',
    whenToUse:
      'Where time goes in a flow: a 10-minute delivery promise, the latency budget of a request, ' +
      'the stages of a deploy. Use it when the split matters more than one number.',
    whenNotToUse:
      'A single countdown (use `timer_ring`); one number (use `counter` or `stat_card`); ' +
      'steps without durations (use `node_card` and `connector`).',
  },
  example: {
    props: {
      segments: [
        { id: 'step-a', label: '<ex-a>', sec: 90 },
        { id: 'step-b', label: '<ex-b>', sec: 120 },
      ],
      budgetSec: 600,
    },
  },
});
