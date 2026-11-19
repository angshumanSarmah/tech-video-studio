import { describe, expect, it } from 'vitest';
import { packetStreamPrimitive, PacketStreamPropsSchema } from './definition.ts';
import { BLOCK_AT, STREAM_TRAVEL_SEC, streamPackets, type StreamInput } from './stream.ts';

const base: StreamInput = { rate: 4, flowSec: undefined, stopSec: undefined, blocked: false };
const ts = (input: Partial<StreamInput>) => streamPackets({ ...base, ...input }).map((p) => p.t);

describe('streamPackets', () => {
  it('draws a steady stream, frozen, without an enter', () => {
    const packets = ts({});
    expect(packets).toHaveLength(Math.round(4 * STREAM_TRAVEL_SEC));
    expect(packets[0]).toBeGreaterThan(0);
  });

  it('is empty until enter, then fills from the source at the rate', () => {
    expect(ts({ flowSec: 0 })).toEqual([]);
    const early = ts({ flowSec: 0.3 });
    expect(early).toHaveLength(2);
    expect(early[0]).toBeCloseTo(0.3 / STREAM_TRAVEL_SEC);
    expect(early[1]).toBeCloseTo(0.05 / STREAM_TRAVEL_SEC);
    const full = ts({ flowSec: 10 });
    expect(full.length).toBeGreaterThanOrEqual(4);
    expect(full.length).toBeLessThanOrEqual(5);
    for (const t of full) expect(t).toBeLessThanOrEqual(1);
  });

  it('stops sending on exit and lets packets in flight arrive', () => {
    const draining = ts({ flowSec: 10, stopSec: 0.6 });
    expect(Math.min(...draining)).toBeGreaterThanOrEqual(0.6 / STREAM_TRAVEL_SEC - 1e-9);
    expect(ts({ flowSec: 10, stopSec: STREAM_TRAVEL_SEC + 0.1 })).toEqual([]);
  });

  it('ignores an exit that came before the latest enter', () => {
    expect(ts({ flowSec: 2, stopSec: 5 })).toEqual(ts({ flowSec: 2 }));
  });

  it('is deterministic for a given time', () => {
    expect(ts({ flowSec: 3.7 })).toEqual(ts({ flowSec: 3.7 }));
  });

  it('blocks packets before the barrier when rejected, fading them out', () => {
    for (const flowSec of [10, 10.1, 10.2]) {
      const packets = streamPackets({ ...base, flowSec, blocked: true });
      expect(packets.length).toBeGreaterThan(0);
      for (const p of packets) expect(p.t).toBeLessThan(BLOCK_AT);
    }
    // The first packet is just short of the barrier.
    const [fading] = streamPackets({ ...base, flowSec: 0.77 * STREAM_TRAVEL_SEC, blocked: true });
    expect(fading?.opacity).toBeGreaterThan(0);
    expect(fading?.opacity).toBeLessThan(1);
  });
});

describe('packet_stream props', () => {
  it('must run along a connector', () => {
    const props = PacketStreamPropsSchema.parse({ along: 'link' });
    expect(packetStreamPrimitive.elementRefs?.(props)).toEqual([
      { path: ['along'], id: 'link', primitives: ['connector'] },
    ]);
    expect(PacketStreamPropsSchema.safeParse({ along: 'link', rate: 20 }).success).toBe(false);
  });
});
