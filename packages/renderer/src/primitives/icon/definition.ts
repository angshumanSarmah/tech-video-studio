import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { AssetIdSchema, semanticProp } from '../common-props.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const IconPropsSchema = z.strictObject({
  asset: AssetIdSchema,
  semantic: semanticProp('neutral', 'Stroke colour'),
});
export type IconProps = z.output<typeof IconPropsSchema>;

/** Glyph side in px: twice the headline size, so it reads as a symbol beside text. */
export function iconSize(theme: Theme): number {
  return theme.text.headline.size * 2;
}

export function iconSizeHints(_props: IconProps, theme: Theme): SizeHints {
  const side = iconSize(theme);
  return { minWidth: side, minHeight: side, preferredWidth: side, preferredHeight: side };
}

export const iconPrimitive = definePrimitive({
  id: 'icon',
  family: 'annotation',
  propsSchema: IconPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: iconSizeHints,
  assetRefs: (props) => [{ path: ['asset'], id: props.asset }],
  description: {
    summary:
      'A single line-drawn symbol from the asset library (server, database, user, lock, cloud), ' +
      'in a semantic colour, with no text.',
    whenToUse:
      'A visual cue next to other elements: what kind of thing is involved, or the idea of the ' +
      'beat (speed, security, time) at a glance.',
    whenNotToUse:
      'A component the story talks about (use `node_card` with an icon); an everyday object ' +
      'with a caption (use `item_icon`); anything that needs a word to be understood.',
  },
  example: { props: { asset: 'database', semantic: 'concept' } },
});
