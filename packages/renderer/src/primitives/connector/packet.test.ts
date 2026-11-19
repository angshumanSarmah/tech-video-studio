import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { connectorPrimitive, ConnectorPropsSchema } from './definition.ts';
import { PACKET_TRAVEL_SEC, packetProgress } from './packet.ts';

describe('packetProgress', () => {
  it('has no packet before the move, and none once it has arrived', () => {
    expect(packetProgress(undefined)).toBeUndefined();
    expect(packetProgress(0)).toBeUndefined();
    expect(packetProgress(PACKET_TRAVEL_SEC)).toBeUndefined();
  });

  it('travels from start to end, easing in and out', () => {
    expect(packetProgress(PACKET_TRAVEL_SEC / 2)).toBeCloseTo(0.5);
    expect(packetProgress(PACKET_TRAVEL_SEC * 0.1)).toBeLessThan(0.1);
  });
});

describe('connector props', () => {
  it('refuses a connector from an element to itself', () => {
    expect(ConnectorPropsSchema.safeParse({ from: 'api', to: 'api' }).success).toBe(false);
  });

  it('points to both endpoints', () => {
    const props = ConnectorPropsSchema.parse({ from: 'client', to: 'api' });
    expect(connectorPrimitive.elementRefs?.(props)).toEqual([
      { path: ['from'], id: 'client' },
      { path: ['to'], id: 'api' },
    ]);
  });

  it('widens for a long label', () => {
    const theme = getTheme();
    const bare = connectorPrimitive.sizeHints(
      ConnectorPropsSchema.parse({ from: 'a', to: 'b' }),
      theme,
    );
    const labelled = connectorPrimitive.sizeHints(
      ConnectorPropsSchema.parse({ from: 'a', to: 'b', label: 'replicates writes' }),
      theme,
    );
    expect(labelled.preferredWidth).toBeGreaterThan(bare.preferredWidth);
  });
});
