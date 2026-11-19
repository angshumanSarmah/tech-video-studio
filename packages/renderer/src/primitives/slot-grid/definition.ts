import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import {
  AssetIdSchema,
  idsOf,
  lineText,
  PartIdSchema,
  partList,
  semanticProp,
} from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';
import { slotGridShape } from './slots.ts';

export const SLOT_KINDS = ['inventory', 'shelf', 'seats', 'documents'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export const SlotSchema = z.strictObject({
  id: PartIdSchema,
  label: lineText(7, 'Short label on the slot, e.g. a seat number or an item name.'),
  icon: AssetIdSchema.optional(),
  semantic: semanticProp('neutral', 'Slot colour'),
});

export const SlotGridPropsSchema = z.strictObject({
  kind: z
    .enum(SLOT_KINDS)
    .default('inventory')
    .describe('How slots look: inventory (bins), shelf (rows on planks), seats, documents.'),
  slots: partList(SlotSchema, { min: 1, max: 24 }, 'The slots, in reading order (1 to 24).'),
  cols: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe('Slots per row; omit to choose from the slot count.'),
  label: lineText(24, 'Optional caption under the grid.').optional(),
});
export type SlotGridProps = z.output<typeof SlotGridPropsSchema>;

/** Icon side inside a slot card. */
export const SLOT_ICON = 48;

export type SlotMetrics = { card: { width: number; height: number }; gap: number; caption: number };

export function slotMetrics(props: SlotGridProps, theme: Theme): SlotMetrics {
  const longest = Math.max(...props.slots.map((s) => approxTextWidth(theme, 'hud', s.label)));
  const hasIcon = props.slots.some((s) => s.icon);
  const width = Math.max(SLOT_ICON, longest) + 2 * theme.space.xs;
  const height =
    (hasIcon ? SLOT_ICON + theme.space.xs : 0) + lineHeightPx(theme, 'hud') + 2 * theme.space.sm;
  return {
    card: { width, height: Math.max(height, width * 0.6) },
    gap: theme.space.md,
    caption: props.label ? theme.space.sm + lineHeightPx(theme, 'label') : 0,
  };
}

export function slotGridSizeHints(props: SlotGridProps, theme: Theme): SizeHints {
  const m = slotMetrics(props, theme);
  const { rows, cols } = slotGridShape(props.slots.length, props.cols);
  // Gaps leave room for corner badges and the lift of a picked slot.
  const width = cols * m.card.width + (cols + 1) * m.gap;
  const height = rows * m.card.height + (rows + 1) * m.gap + m.caption;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const slotGridPrimitive = definePrimitive({
  id: 'slot_grid',
  family: 'object',
  propsSchema: SlotGridPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim'],
  sizeHints: slotGridSizeHints,
  assetRefs: (props) =>
    props.slots.flatMap((s, i) => (s.icon ? [{ path: ['slots', i, 'icon'], id: s.icon }] : [])),
  parts: {
    actions: ['enter', 'exit', 'lock', 'highlight', 'reject', 'pulse', 'dim'],
    ids: (props) => idsOf(props.slots),
  },
  description: {
    summary:
      'A grid of labelled slots: bins of stock, a shelf, cinema seats or documents. Each slot is ' +
      'a part: `lock` claims it (padlock, yellow), `highlight` picks it out, `exit` takes its ' +
      'item (it lifts away and leaves an empty outline), `enter` puts an item back, `reject` ' +
      'turns it red with a cross (sold out, conflict).',
    whenToUse:
      'Contention over specific items: two users grabbing the same seat, stock picked from bins, ' +
      'which documents a search touches. Address the slots on the words that act on them.',
    whenNotToUse:
      'Items moving in order (use `conveyor_queue`); a spatial grid over a map (use ' +
      '`grid_overlay`); one standalone object (use `item_icon`).',
  },
  example: {
    props: {
      kind: 'seats',
      slots: [
        { id: 'seat-1', label: '<ex-1>' },
        { id: 'seat-2', label: '<ex-2>' },
        { id: 'seat-3', label: '<ex-3>' },
      ],
    },
  },
});
