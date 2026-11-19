import { describe, expect, it } from 'vitest';
import { distance } from '../geometry.ts';
import { MAX_ZONES, zoneShapes } from './zones.ts';

const box = { width: 800, height: 700 };
const radius = (shape: ReturnType<typeof zoneShapes>[number]) =>
  Math.min(...shape.points.map((p) => distance(p, shape.centre)));
const maxRadius = (shape: ReturnType<typeof zoneShapes>[number]) =>
  Math.max(...shape.points.map((p) => distance(p, shape.centre)));

describe('zoneShapes', () => {
  it.each(Array.from({ length: MAX_ZONES }, (_, i) => i + 1))(
    'draws %i zones inside the box, deterministically',
    (count) => {
      const shapes = zoneShapes(count, box, true);
      expect(shapes).toHaveLength(count);
      expect(zoneShapes(count, box, true)).toEqual(shapes);
      for (const p of shapes.flatMap((s) => s.points)) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(box.width + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(box.height + 1e-6);
      }
    },
  );

  it('overlaps neighbours when asked, and keeps a gap otherwise', () => {
    const [a, b] = zoneShapes(2, box, true);
    if (!a || !b) throw new Error('two zones expected');
    expect(radius(a) + radius(b)).toBeGreaterThan(distance(a.centre, b.centre));
    const [c, d] = zoneShapes(2, box, false);
    if (!c || !d) throw new Error('two zones expected');
    expect(maxRadius(c) + maxRadius(d)).toBeLessThan(distance(c.centre, d.centre));
  });

  it('gives each zone its own outline', () => {
    const [a, b] = zoneShapes(2, box, true);
    const offsets = (s: typeof a) => s?.points.map((p) => Math.round(distance(p, s.centre)));
    expect(offsets(a)).not.toEqual(offsets(b));
  });
});
