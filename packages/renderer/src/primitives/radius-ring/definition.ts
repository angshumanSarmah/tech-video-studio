import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { elementRefProp, lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const RadiusRingPropsSchema = z.strictObject({
  around: elementRefProp('Id of the element in this beat at the centre of the circle.'),
  label: lineText(16, 'Optional label on the ring, e.g. 2 KM.').optional(),
  semantic: semanticProp('focus', 'Ring colour'),
});
export type RadiusRingProps = z.output<typeof RadiusRingPropsSchema>;

/** Standalone diameter until the layout engine (P1A.9) sizes it around its centre element. */
const DIAMETER = 520;
const MIN_DIAMETER = 320;

export function radiusRingSizeHints(props: RadiusRingProps, theme: Theme): SizeHints {
  const label = props.label ? approxTextWidth(theme, 'tag', props.label) + 2 * theme.space.sm : 0;
  const min = Math.max(MIN_DIAMETER, label + 2 * theme.space.xl);
  const top = props.label ? lineHeightPx(theme, 'tag') : 0;
  return {
    minWidth: min,
    minHeight: min + top,
    preferredWidth: Math.max(min, DIAMETER),
    preferredHeight: Math.max(min, DIAMETER) + top,
  };
}

export const radiusRingPrimitive = definePrimitive({
  id: 'radius_ring',
  family: 'spatial',
  propsSchema: RadiusRingPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: radiusRingSizeHints,
  elementRefs: (props) => [{ path: ['around'], id: props.around }],
  description: {
    summary:
      'A dashed search circle centred on the element `around`, with an optional `label` on ' +
      'its rim (the radius, or what is searched). `enter` grows it out from the centre.',
    whenToUse:
      'A search area or reach: riders within 2 km of a restaurant, servers within one network ' +
      'hop, the candidates a matcher considers around a target.',
    whenNotToUse:
      'A named area with edges (use `zone_polygon`); a grid of cells (use `grid_overlay`); a ' +
      'countdown (use `timer_ring`).',
  },
  example: { props: { around: 'example-target', label: '<example-radius>' } },
});
