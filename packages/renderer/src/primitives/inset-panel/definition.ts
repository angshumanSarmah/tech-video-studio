import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { elementRefList, elementRefProp, lineText, semanticProp } from '../common-props.ts';
import { lineHeightPx } from '../measure.ts';
import { definePrimitive, type ElementRef, type SizeHints } from '../types.ts';

export const InsetPanelPropsSchema = z
  .strictObject({
    title: lineText(28, 'Optional title in the panel header: what the detail shows.').optional(),
    anchor: elementRefProp(
      'Optional id of the element the panel zooms out of (and shrinks back into).',
    ).optional(),
    children: elementRefList(
      { min: 1, max: 4 },
      'Ids of the elements in this beat drawn inside the panel; they show only while it does.',
    ),
    semantic: semanticProp('neutral', 'Frame colour'),
  })
  .refine((p) => !p.anchor || !p.children.includes(p.anchor), {
    message: 'The anchor is the element the panel zooms out of; it cannot also be inside it.',
    path: ['anchor'],
  });
export type InsetPanelProps = z.output<typeof InsetPanelPropsSchema>;

/** Panel size over the 936×1080 stage until the layout engine (P1A.9) sizes it from its children. */
const WIDTH = 860;
const HEIGHT = 900;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 480;

/** Height of the title header (title line, padding and rule); 0 without a title. */
export function insetHeaderHeight(props: InsetPanelProps, theme: Theme): number {
  return props.title ? lineHeightPx(theme, 'label') + 2 * theme.space.sm : 0;
}

export function insetPanelSizeHints(props: InsetPanelProps, theme: Theme): SizeHints {
  const header = insetHeaderHeight(props, theme);
  return {
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT + header,
    preferredWidth: WIDTH,
    preferredHeight: HEIGHT,
  };
}

export function insetPanelRefs(props: InsetPanelProps): ElementRef[] {
  return [
    ...(props.anchor ? [{ path: ['anchor'], id: props.anchor }] : []),
    ...props.children.map((id, i) => ({ path: ['children', i], id, contains: true })),
  ];
}

export const insetPanelPrimitive = definePrimitive({
  id: 'inset_panel',
  family: 'annotation',
  propsSchema: InsetPanelPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: insetPanelSizeHints,
  layer: 'overlay',
  elementRefs: insetPanelRefs,
  description: {
    summary:
      'A framed detail card that zooms in over the scene while everything behind it dims. It ' +
      'holds other elements of the beat (`children`: e.g. a `data_block`, a ' +
      '`counter_transition`, a `slot_grid`, a `map_base` or a `segmented_time_bar`), drawn ' +
      'inside it and shown only while it is. `enter` zooms it out of its `anchor`; `exit` ' +
      'shrinks it back in. Children keep their own events (enter, count, highlight).',
    whenToUse:
      'A closer look at one part of the diagram: what is inside a cache entry, the features a ' +
      'model reads for one transaction, the bins behind a warehouse pin, the time budget of one build.',
    whenNotToUse:
      'Text only (use `statement_card` or `callout`); a whole new scene (start a new beat). ' +
      'Show at most one overlay at a time, and never put an overlay inside it.',
  },
  example: {
    props: {
      title: '<example-detail>',
      anchor: 'example-anchor',
      children: ['example-child'],
    },
  },
});
