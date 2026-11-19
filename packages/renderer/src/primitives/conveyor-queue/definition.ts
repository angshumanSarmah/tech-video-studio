import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { idsOf, lineText, PartIdSchema, partList, semanticProp } from '../common-props.ts';
import { approxTextWidth, lineHeightPx } from '../measure.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const ConveyorItemSchema = z.strictObject({
  id: PartIdSchema,
  label: lineText(7, 'Short label on the block, e.g. an order number.'),
  semantic: semanticProp('neutral', 'Block colour'),
});

export const ConveyorQueuePropsSchema = z.strictObject({
  items: partList(
    ConveyorItemSchema,
    { min: 1, max: 6 },
    'Blocks in arrival order: the first is at the front and is taken first.',
  ),
  label: lineText(24, 'Optional caption under the belt: what the queue is.').optional(),
});
export type ConveyorQueueProps = z.output<typeof ConveyorQueuePropsSchema>;

/** Smallest block side, so one-character labels still read as blocks. */
const MIN_BLOCK = 88;

export type ConveyorMetrics = {
  block: { width: number; height: number };
  /** Distance between neighbouring blocks' centres. */
  pitch: number;
  /** Belt band height under the blocks. */
  belt: number;
  /** Room above the blocks for a lock or reject mark, and for the lift when a block is taken. */
  headroom: number;
  pad: number;
  caption: number;
};

export function conveyorMetrics(props: ConveyorQueueProps, theme: Theme): ConveyorMetrics {
  const longest = Math.max(...props.items.map((i) => approxTextWidth(theme, 'hud', i.label)));
  const width = Math.max(MIN_BLOCK, longest + 2 * theme.space.xs);
  return {
    block: { width, height: MIN_BLOCK },
    pitch: width + theme.space.sm,
    belt: theme.space.lg,
    headroom: theme.space.xl,
    pad: theme.space.md,
    caption: props.label ? theme.space.sm + lineHeightPx(theme, 'label') : 0,
  };
}

export function conveyorSizeHints(props: ConveyorQueueProps, theme: Theme): SizeHints {
  const m = conveyorMetrics(props, theme);
  const width = props.items.length * m.pitch + 2 * m.pad + m.belt;
  const height = m.headroom + m.block.height + m.belt + m.caption;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const conveyorQueuePrimitive = definePrimitive({
  id: 'conveyor_queue',
  family: 'flow',
  propsSchema: ConveyorQueuePropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse'],
  sizeHints: conveyorSizeHints,
  parts: {
    actions: ['enter', 'exit', 'highlight', 'pulse', 'lock', 'reject'],
    ids: (props) => idsOf(props.items),
  },
  description: {
    summary:
      'A horizontal belt carrying labelled blocks toward its right end, where they are taken. ' +
      '`items` are parts, listed in arrival order: `enter` slides one in from the left behind ' +
      'the others, `exit` takes it off the belt (it lifts away and the rest move up), `lock` ' +
      'marks it as claimed, `reject` turns it red. An item is on the belt from the start unless ' +
      'it first appears with `enter`.',
    whenToUse:
      'Work waiting its turn: orders in a queue, jobs for a worker, messages in a partition. ' +
      'Take items on the words where they are processed.',
    whenNotToUse:
      'Traffic that never waits (use `packet_stream`); items on a shelf or seats picked in any ' +
      'order (use `slot_grid`); a count of waiting work (use `counter`).',
  },
  example: {
    props: {
      items: [
        { id: 'first', label: '<ex-1>' },
        { id: 'second', label: '<ex-2>' },
      ],
      label: '<example-queue-name>',
    },
  },
});
