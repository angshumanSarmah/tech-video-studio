import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { AssetIdSchema, lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const ItemIconPropsSchema = z.strictObject({
  asset: AssetIdSchema,
  caption: lineText(24, 'What the object is in this story, shown under it.'),
  semantic: semanticProp('neutral', 'Tile colour'),
});
export type ItemIconProps = z.output<typeof ItemIconPropsSchema>;

/** Tile side in px; the glyph fills 60% of it. */
export function itemTileSize(theme: Theme): number {
  return Math.round(theme.text.metric.size * 1.4);
}

export const ITEM_GLYPH_SCALE = 0.6;

export function itemIconSizeHints(props: ItemIconProps, theme: Theme): SizeHints {
  const tile = itemTileSize(theme);
  const width = Math.max(tile, approxTextWidth(theme, 'label', props.caption));
  const height = tile + theme.space.sm + lineHeightPx(theme, 'label');
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const itemIconPrimitive = definePrimitive({
  id: 'item_icon',
  family: 'annotation',
  zoomable: true,
  propsSchema: ItemIconPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: itemIconSizeHints,
  assetRefs: (props) => [{ path: ['asset'], id: props.asset, family: 'object' }],
  description: {
    summary:
      'A flat everyday object from the asset library (phone, car, ticket, parcel, pizza) on a ' +
      'soft tile, with a caption under it. `reject` turns it red with a cross and a shake.',
    whenToUse:
      'The real-world thing the system is about: the parcel, the payment card, the ticket, the ' +
      "user's phone. Grounds an abstract flow in something the viewer has held.",
    whenNotToUse:
      'A system component (use `node_card`); a bare symbol without a caption (use `icon`); data ' +
      'about the object (use `data_block`).',
  },
  example: { props: { asset: 'ticket', caption: '<example-caption>' } },
});
