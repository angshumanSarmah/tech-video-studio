import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { KEY_ELEMENT_MIN_SHARE, keyElementWarnings } from './key-size.ts';
import type { PlacedItem } from './types.ts';

/** Run 1's b2 in shape: two icons 73 px wide on a 936 px frame, a wide stat card, two tags. */
const frame = { x: 72, y: 540, width: 936, height: 895 };
const prim = (key: string, primitive: string) =>
  ({
    kind: 'primitive',
    key,
    definition: DEFAULT_REGISTRIES.primitives.get(primitive)!,
  }) as WorldItem;
const placed = (
  key: string,
  role: PlacedItem['role'],
  width: number,
  height: number,
): PlacedItem => ({
  key,
  role,
  rect: { x: 0, y: 0, width, height },
  scale: 0.79,
  z: 4,
});
const world = [
  prim('icon-ram', 'icon'),
  prim('icon-disk', 'icon'),
  prim('stat-gap', 'stat_card'),
  prim('tag-ram', 'tag'),
];

describe('keyElementWarnings', () => {
  it("flags run 1's b2 icons, not the stat card or the pinned tag", () => {
    const items = [
      placed('icon-ram', 'solid', 72.8, 72.8),
      placed('icon-disk', 'solid', 72.8, 72.8),
      placed('stat-gap', 'solid', 540, 182),
      placed('tag-ram', 'pin', 248, 53),
    ];
    const [warning, ...rest] = keyElementWarnings(world, { items, frame });
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({
      code: 'key_element_too_small',
      keys: ['icon-ram', 'icon-disk'],
    });
    expect(warning!.message).toContain('icon-ram 73 x 73 px, icon-disk 73 x 73 px, under 94 px');
  });

  it('passes components at a tenth of the frame or more, and never counts labels', () => {
    const min = frame.width * KEY_ELEMENT_MIN_SHARE;
    const items = [placed('icon-ram', 'solid', min, min), placed('tag-ram', 'solid', 40, 20)];
    expect(keyElementWarnings(world, { items, frame })).toEqual([]);
  });
});
