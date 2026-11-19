import { describe, expect, it } from 'vitest';
import {
  arrowHead,
  partialPolyline,
  pathD,
  pointAlong,
  polylineLength,
  smoothstep,
  standalonePath,
  type Point,
} from './geometry.ts';

const L: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
];

describe('polyline geometry', () => {
  it('measures the length of every segment', () => {
    expect(polylineLength(L)).toBe(150);
    expect(polylineLength([])).toBe(0);
  });

  it('finds the point and angle at a fraction of the length, clamped', () => {
    expect(pointAlong(L, 0.5)).toEqual({ point: { x: 75, y: 0 }, angle: 0 });
    expect(pointAlong(L, 0.9).point).toEqual({ x: 100, y: 35 });
    expect(pointAlong(L, 0.9).angle).toBeCloseTo(Math.PI / 2);
    expect(pointAlong(L, 2).point).toEqual({ x: 100, y: 50 });
    expect(pointAlong(L, -1).point).toEqual({ x: 0, y: 0 });
  });

  it('cuts the path at a fraction, keeping the corners passed', () => {
    expect(partialPolyline(L, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(partialPolyline(L, 0.8)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
    ]);
    expect(partialPolyline(L, 1)).toEqual(L);
    expect(partialPolyline([], 0.5)).toEqual([]);
  });

  it('writes SVG path data', () => {
    expect(pathD(L)).toBe('M 0 0 L 100 0 L 100 50');
  });

  it('draws a standalone path through the middle of the box', () => {
    expect(standalonePath({ width: 300, height: 80 }, 20)).toEqual([
      { x: 20, y: 40 },
      { x: 280, y: 40 },
    ]);
  });
});

describe('arrowHead', () => {
  it('points along the angle with a base as wide as its length', () => {
    const [tip, a, b] = arrowHead({ x: 100, y: 50 }, 0, 20);
    expect(tip).toEqual({ x: 100, y: 50 });
    expect(a).toEqual({ x: 80, y: 60 });
    expect(b).toEqual({ x: 80, y: 40 });
  });
});

describe('smoothstep', () => {
  it('eases in and out, clamped', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(0.1)).toBeLessThan(0.1);
    expect(smoothstep(2)).toBe(1);
  });
});
