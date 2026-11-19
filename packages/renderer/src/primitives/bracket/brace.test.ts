import { describe, expect, it } from 'vitest';
import { bracePoints } from './brace.ts';

describe('bracePoints', () => {
  const points = bracePoints(400, 40);

  it('starts and ends at the top corners and reaches its tip at the middle', () => {
    expect(points[0]?.x).toBeCloseTo(0);
    expect(points[0]?.y).toBeCloseTo(0);
    expect(points.at(-1)?.x).toBeCloseTo(400);
    expect(points.at(-1)?.y).toBeCloseTo(0);
    const tip = points.reduce((a, b) => (b.y > a.y ? b : a));
    expect(tip.x).toBeCloseTo(200);
    expect(tip.y).toBeCloseTo(40);
  });

  it('is symmetric and runs left to right', () => {
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]?.x ?? 0).toBeGreaterThanOrEqual((points[i - 1]?.x ?? 0) - 1e-9);
    }
    const n = points.length;
    expect(points[2]?.y).toBeCloseTo(points[n - 3]?.y ?? NaN);
  });

  it('keeps short braces inside their box', () => {
    for (const p of bracePoints(60, 40)) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(60 + 1e-9);
      expect(p.y).toBeLessThanOrEqual(40 + 1e-9);
    }
  });
});
