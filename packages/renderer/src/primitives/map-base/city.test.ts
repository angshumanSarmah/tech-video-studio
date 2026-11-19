import { describe, expect, it } from 'vitest';
import { cityMap, distanceToSegment, MAP_VARIANTS, mulberry32, RIVER_WIDTH } from './city.ts';

const box = { width: 880, height: 880 };

describe('cityMap', () => {
  it.each(MAP_VARIANTS)('draws the same %s city every time, inside the box', (variant) => {
    const city = cityMap(variant, box);
    expect(cityMap(variant, box)).toEqual(city);
    expect(city.blocks.length).toBeGreaterThan(8);
    expect(city.streets.some((s) => s.avenue)).toBe(true);
    for (const b of city.blocks) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(box.width);
      expect(b.y + b.height).toBeLessThanOrEqual(box.height);
    }
  });

  it('draws different cities per variant', () => {
    expect(cityMap('downtown', box).blocks).not.toEqual(cityMap('suburb', box).blocks);
    expect(cityMap('downtown', box).blocks.length).toBeGreaterThan(
      cityMap('suburb', box).blocks.length,
    );
  });

  it('keeps blocks off the river', () => {
    const { river, blocks } = cityMap('riverside', box);
    expect(river.length).toBeGreaterThan(2);
    expect(cityMap('downtown', box).river).toEqual([]);
    for (const b of blocks) {
      const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const nearest = Math.min(
        ...river.slice(1).map((p, i) => distanceToSegment(centre, river[i] ?? p, p)),
      );
      expect(nearest).toBeGreaterThan(RIVER_WIDTH / 2);
    }
  });
});

describe('mulberry32', () => {
  it('repeats its sequence for a seed and stays in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const values = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(values);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
