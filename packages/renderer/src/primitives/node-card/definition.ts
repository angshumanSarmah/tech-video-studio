import { cardOutline } from '../surface.ts';
import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { AssetIdSchema, lineText, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

/** Longest subtitle: it stays on one line, and the card grows to fit it up to this. */
export const NODE_SUBTITLE_MAX = 28;

export const NodeCardPropsSchema = z.strictObject({
  title: lineText(24, 'Name of the component, shown in uppercase.'),
  subtitle: lineText(
    NODE_SUBTITLE_MAX,
    `Optional second line: its role or a detail. One line, at most ${NODE_SUBTITLE_MAX} characters.`,
  ).optional(),
  icon: AssetIdSchema.optional(),
  role: AssetIdSchema.optional().describe(
    'Optional role badge (asset id, e.g. a crown for a leader) at the top centre. It is the ' +
      'part "role": exit it on the old holder and enter it on the new one to move the role.',
  ),
  semantic: semanticProp('neutral', 'Border and glow colour'),
});
export type NodeCardProps = z.output<typeof NodeCardPropsSchema>;

/** The part id of the role badge. */
export const ROLE_PART = 'role';

/** Glyph side as a multiple of the title's line height. */
const ICON_SCALE = 1.25;

export function nodeCardIconSize(theme: Theme): number {
  return Math.round(lineHeightPx(theme, 'title') * ICON_SCALE);
}

/**
 * Room for the one-line subtitle: its estimated width plus slack (average advances run short on
 * wide glyphs such as `·`), never more than a full-length subtitle needs.
 */
export function subtitleWidth(theme: Theme, subtitle: string): number {
  const max = approxTextWidth(theme, 'label', 'M'.repeat(NODE_SUBTITLE_MAX));
  const estimate = approxTextWidth(theme, 'label', subtitle) * SUBTITLE_SLACK + theme.space.xs;
  return Math.ceil(Math.min(max, estimate));
}

/** Extra width on the subtitle estimate, so the line never wraps. */
const SUBTITLE_SLACK = 1.1;

export function nodeCardSizeHints(props: NodeCardProps, theme: Theme): SizeHints {
  const { space, stroke } = theme;
  const icon = props.icon ? nodeCardIconSize(theme) + space.md : 0;
  const subtitle = props.subtitle ? subtitleWidth(theme, props.subtitle) : 0;
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
  outline: (props, box, theme) => cardOutline(theme, props.semantic, box),
  assetRefs: (props) => [
    ...(props.icon ? [{ path: ['icon'], id: props.icon }] : []),
    ...(props.role ? [{ path: ['role'], id: props.role }] : []),
  ],
  parts: {
    actions: ['enter', 'exit', 'pulse'],
    ids: (props) => (props.role ? [ROLE_PART] : []),
  },
  description: {
    summary:
      'A titled card for one component of a system (a service, server, database, client or ' +
      'queue), with an optional subtitle and icon. `lock` adds a padlock badge; `reject` turns ' +
      'it red with a cross and a shake. An optional `role` badge (a crown for the leader) sits ' +
      'at the top centre as the part "role": `exit` it on the old holder and `enter` it on the ' +
      'new one to hand the role over (a role whose first part event is `enter` starts hidden).',
    whenToUse:
      'The boxes of a system diagram: anything the story treats as a component that receives, ' +
      'holds or sends something.',
    whenNotToUse:
      'A label or status (use `tag`); a quantity (use `counter`); an everyday object (use ' +
      '`item_icon`); a bare symbol (use `icon`).',
  },
  example: {
    props: { title: '<example-name>', subtitle: '<example-role>', icon: 'server', role: 'crown' },
  },
});
