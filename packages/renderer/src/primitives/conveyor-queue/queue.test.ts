import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { conveyorQueuePrimitive, ConveyorQueuePropsSchema } from './definition.ts';
import { queuePlaces, treadShift, type QueueGeometry } from './queue.ts';

const g: QueueGeometry = { headX: 500, pitch: 100, entryX: 0, liftPx: 60 };
const here = { presence: 1, taken: 0 };

describe('queuePlaces', () => {
  it('lines blocks up from the front, one pitch apart', () => {
    expect(queuePlaces([here, here, here], g).map((p) => p.x)).toEqual([500, 400, 300]);
  });

  it('slides an arriving block in from the entry point behind the others', () => {
    const [, arriving] = queuePlaces([here, { presence: 0.5, taken: 0 }], g);
    expect(arriving).toEqual({ x: 200, lift: 0, opacity: 0.5 });
    const [, absent] = queuePlaces([here, { presence: 0, taken: 0 }], g);
    expect(absent?.opacity).toBe(0);
  });

  it('lifts a taken block in place while the ones behind move up', () => {
    const halfway = queuePlaces([{ presence: 0.5, taken: 0.5 }, here, here], g);
    expect(halfway[0]).toEqual({ x: 500, lift: 30, opacity: 0.5 });
    expect(halfway.slice(1).map((p) => p.x)).toEqual([450, 350]);
    const done = queuePlaces([{ presence: 0, taken: 1 }, here, here], g);
    expect(done.slice(1).map((p) => p.x)).toEqual([500, 400]);
  });

  it('moves the treads one pitch per block taken', () => {
    expect(treadShift([{ presence: 0, taken: 1 }, { presence: 0.5, taken: 0.5 }, here], 100)).toBe(
      150,
    );
  });
});

describe('conveyor_queue size', () => {
  it('fits six blocks with the longest labels inside the stage width', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, label: 'ORD-421' }));
    const hints = conveyorQueuePrimitive.sizeHints(
      ConveyorQueuePropsSchema.parse({ items }),
      getTheme(),
    );
    expect(hints.preferredWidth).toBeLessThanOrEqual(936);
  });
});
