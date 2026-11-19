import { z } from 'zod';
import type { Rect, Theme } from '../../theme/index.ts';
import { elementRefList, elementRefProp, lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type Size, type SizeHints } from '../types.ts';

export const RadiusRingPropsSchema = z.strictObject({
  around: elementRefProp('Id of the element in this beat at the centre of the circle.'),
  encloses: elementRefList(
    { min: 1, max: 8 },
    'Optional ids of elements the ring must enclose (the candidates in reach); it grows to fit them.',
  ).optional(),
  label: lineText(16, 'Optional label on the ring, e.g. 2 KM.').optional(),
  semantic: semanticProp('focus', 'Ring colour'),
});
export type RadiusRingProps = z.output<typeof RadiusRingPropsSchema>;

/** Standalone (and minimum on a board) diameter; the layout grows it to enclose its target. */
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

/** Size of the rim label, as the component draws it (text plus its pill padding). */
function labelSize(props: RadiusRingProps, theme: Theme) {
  return {
    width: approxTextWidth(theme, 'tag', props.label ?? '') + 2 * theme.space.sm,
    height: lineHeightPx(theme, 'tag') + 2 * theme.space.xs,
  };
}

/** Geometry the component draws in its box: the circle's centre and radius (the rim). */
export function ringGeometry(box: Size, theme: Theme) {
  const size = Math.min(box.width, box.height);
  const r = size / 2 - theme.stroke.bold;
  return { c: { x: box.width / 2, y: box.height - size / 2 }, r };
}

/** The rim label sits outside the ring's body (on the circle's top): elements must not cover it. */
export function radiusRingTextRects(props: RadiusRingProps, box: Size, theme: Theme): Rect[] {
  if (!props.label) return [];
  const { c, r } = ringGeometry(box, theme);
  const { width, height } = labelSize(props, theme);
  return [{ x: c.x - width / 2, y: c.y - r - height / 2, width, height }];
}

export const radiusRingPrimitive = definePrimitive({
  id: 'radius_ring',
  family: 'spatial',
  propsSchema: RadiusRingPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  layoutRole: 'ring',
  sizeHints: radiusRingSizeHints,
  elementRefs: (props) => [
    { path: ['around'], id: props.around },
    ...(props.encloses ?? []).map((id, i) => ({ path: ['encloses', i], id })),
  ],
  textRects: radiusRingTextRects,
  description: {
    summary:
      'A dashed search circle centred on the element `around`, with an optional `label` on ' +
      'its rim (the radius, or what is searched). `encloses` lists elements that must sit ' +
      'inside it (the circle grows to fit them). `enter` grows it out from the centre.',
    whenToUse:
      'A search area or reach: couriers within 2 km of a depot, servers within one network ' +
      'hop, the candidates a matcher considers around a target.',
    whenNotToUse:
      'A named area with edges (use `zone_polygon`); a grid of cells (use `grid_overlay`); a ' +
      'countdown (use `timer_ring`).',
  },
  example: {
    props: { around: 'example-target', encloses: ['example-candidate'], label: '<example-radius>' },
  },
});
