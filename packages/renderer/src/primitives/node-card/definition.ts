import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { AssetIdSchema, lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const NodeCardPropsSchema = z.strictObject({
  title: lineText(24, 'Name of the component, shown in uppercase.'),
  subtitle: lineText(40, 'Optional second line: its role or a detail.').optional(),
  icon: AssetIdSchema.optional(),
  semantic: semanticProp('neutral', 'Border and glow colour'),
});
export type NodeCardProps = z.output<typeof NodeCardPropsSchema>;

/** Glyph side as a multiple of the title's line height. */
const ICON_SCALE = 1.25;

export function nodeCardIconSize(theme: Theme): number {
  return Math.round(lineHeightPx(theme, 'title') * ICON_SCALE);
}

export function nodeCardSizeHints(props: NodeCardProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const icon = props.icon ? nodeCardIconSize(theme) + space.md : 0;
  const subtitle = props.subtitle ? approxTextWidth(theme, 'label', props.subtitle) : 0;
  const text = Math.max(approxTextWidth(theme, 'title', props.title), subtitle);
  const textHeight =
    lineHeightPx(theme, 'title') + (props.subtitle ? space.xs + lineHeightPx(theme, 'label') : 0);
  const inner = Math.max(textHeight, props.icon ? nodeCardIconSize(theme) : 0);
  const width = icon + text + 2 * (space.lg + stroke.regular);
  const height = inner + 2 * (space.md + stroke.regular);
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const nodeCardPrimitive = definePrimitive({
  id: 'node_card',
  family: 'annotation',
  propsSchema: NodeCardPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'lock', 'reject'],
  sizeHints: nodeCardSizeHints,
  assetRefs: (props) => (props.icon ? [{ path: ['icon'], id: props.icon }] : []),
  description: {
    summary:
      'A titled card for one component of a system (a service, server, database, client or ' +
      'queue), with an optional subtitle and icon. `lock` adds a padlock badge; `reject` turns ' +
      'it red with a cross and a shake.',
    whenToUse:
      'The boxes of a system diagram: anything the story treats as a component that receives, ' +
      'holds or sends something.',
    whenNotToUse:
      'A label or status (use `tag`); a quantity (use `counter`); an everyday object (use ' +
      '`item_icon`); a bare symbol (use `icon`).',
  },
  example: {
    props: { title: '<example-name>', subtitle: '<example-role>', icon: 'server' },
  },
});
