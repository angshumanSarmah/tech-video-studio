import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

/** 99:59, the longest mm:ss. */
export const TIMER_MAX_SEC = 5999;

export const TimerRingPropsSchema = z.strictObject({
  durationSec: z
    .number()
    .int()
    .min(1)
    .max(TIMER_MAX_SEC)
    .describe('Time on the clock when it starts, in seconds (600 shows 10:00).'),
  label: lineText(24, 'Caption under the ring: what the time is for.').optional(),
  semantic: semanticProp('focus', 'Ring colour while running'),
});
export type TimerRingProps = z.output<typeof TimerRingPropsSchema>;

/** Ring diameter in px. */
export function timerRingDiameter(theme: Theme): number {
  return Math.round(theme.text.metric.size * 2.4);
}

/** Clock digits inside the ring: the metric face at about half size. */
export function timerDigitsSize(theme: Theme): number {
  return Math.round(theme.text.metric.size * 0.55);
}

export function timerRingSizeHints(props: TimerRingProps, theme: Theme): SizeHints {
  const ring = timerRingDiameter(theme);
  const label = props.label ? approxTextWidth(theme, 'label', props.label) : 0;
  const width = Math.max(ring, label);
  const height = ring + (props.label ? theme.space.sm + lineHeightPx(theme, 'label') : 0);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const timerRingPrimitive = definePrimitive({
  id: 'timer_ring',
  family: 'metric',
  propsSchema: TimerRingPropsSchema,
  actions: ['enter', 'exit', 'count', 'reject', 'highlight', 'dim', 'pulse'],
  sizeHints: timerRingSizeHints,
  description: {
    summary:
      'A countdown ring with the time left as mm:ss in the middle. It shows `durationSec` until ' +
      '`count` starts the clock. Its pace is set by the narration: it reaches 00:00 exactly on ' +
      'the `reject` (expiry: empty ring, red flash); without `reject` it runs out at the ' +
      "element's `exit` or the end of the beat, and holds 00:00. It never runs slower than real " +
      'time; when faster, a fast-forward tag shows the multiplier (e.g. 60×).',
    whenToUse:
      'A deadline or hold in the story: a room held for 10 minutes, a token that expires, a ' +
      'lease or a timeout. Put `count` where the clock starts and `reject` on the word where the ' +
      'time runs out.',
    whenNotToUse:
      'A quantity that is not time (use `counter`); elapsed time across the whole video (that ' +
      'is the story clock in the HUD); a duration that never runs down.',
  },
  example: { props: { durationSec: 600, label: '<example-caption>' } },
});
