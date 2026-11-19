import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { slotGridPrimitive, SlotGridPropsSchema } from './definition.ts';
import { slotGridShape, slotRows } from './slots.ts';

describe('slotGridShape', () => {
  it.each([
    [3, undefined, { rows: 1, cols: 3 }],
    [6, undefined, { rows: 2, cols: 3 }],
    [12, undefined, { rows: 3, cols: 4 }],
    [24, undefined, { rows: 4, cols: 6 }],
    [10, 5, { rows: 2, cols: 5 }],
    [2, 6, { rows: 1, cols: 2 }],
  ])('lays %i slots (cols %s) out as %o', (count, cols, shape) => {
    expect(slotGridShape(count, cols)).toEqual(shape);
  });
});

describe('slotRows', () => {
  it('splits slots into rows in reading order', () => {
    expect(slotRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('slot_grid', () => {
  it('fits 24 seats with the longest labels inside the stage', () => {
    const slots = Array.from({ length: 24 }, (_, i) => ({ id: `s${i}`, label: 'ROW-H12' }));
    const hints = slotGridPrimitive.sizeHints(
      SlotGridPropsSchema.parse({ kind: 'seats', slots }),
      getTheme(),
    );
    expect(hints.preferredWidth).toBeLessThanOrEqual(936);
    expect(hints.preferredHeight).toBeLessThanOrEqual(940);
  });

  it('reports slot icons as asset refs', () => {
    const props = SlotGridPropsSchema.parse({
      slots: [
        { id: 'milk', label: 'MILK', icon: 'coffee' },
        { id: 'bread', label: 'BREAD' },
      ],
    });
    expect(slotGridPrimitive.assetRefs?.(props)).toEqual([
      { path: ['slots', 0, 'icon'], id: 'coffee' },
    ]);
  });
});
