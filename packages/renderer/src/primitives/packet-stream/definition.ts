import { z } from 'zod';
import type { Theme } from '../../theme/index.ts';
import { elementRefProp, semanticProp } from '../common-props.ts';
import { connectorInset } from '../connector/definition.ts';
import { definePrimitive, type SizeHints } from '../types.ts';

export const PacketStreamPropsSchema = z.strictObject({
  along: elementRefProp('Id of the connector in this beat that the packets travel along.'),
  rate: z.number().min(0.5).max(12).default(3).describe('Packets per second (0.5 to 12).'),
  semantic: semanticProp('concept', 'Packet colour'),
});
export type PacketStreamProps = z.output<typeof PacketStreamPropsSchema>;

/** Standalone span: long enough for a few packets in flight at once. */
const MIN_SPAN = 360;

export function packetStreamSizeHints(_props: PacketStreamProps, theme: Theme): SizeHints {
  const width = MIN_SPAN + 2 * connectorInset(theme);
  const height = 2 * theme.space.lg;
  return { minWidth: width, minHeight: height, preferredWidth: width, preferredHeight: height };
}

export const packetStreamPrimitive = definePrimitive({
  id: 'packet_stream',
  family: 'flow',
  propsSchema: PacketStreamPropsSchema,
  actions: ['enter', 'exit', 'highlight', 'dim', 'pulse', 'reject'],
  sizeHints: packetStreamSizeHints,
  elementRefs: (props) => [{ path: ['along'], id: props.along, primitives: ['connector'] }],
  description: {
    summary:
      'A steady stream of small packets flowing along a `connector`, at `rate` packets per ' +
      'second. `enter` starts the flow from the source; `exit` stops sending (packets in flight ' +
      'still arrive); `reject` blocks the stream before the target: packets turn red and vanish ' +
      'at a barrier.',
    whenToUse:
      'Ongoing traffic between two elements: requests pouring into a server, events into a ' +
      'queue, replication. Raise `rate` to show load growing.',
    whenNotToUse:
      'A single request or hop (a move on the `connector` itself); items waiting in order (use ' +
      '`conveyor_queue`); a number of requests (use `counter`).',
  },
  example: { props: { along: 'example-connector', rate: 4, semantic: 'concept' } },
});
