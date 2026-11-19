import { describe, expect, it } from 'vitest';
import { midSegment, roundCorners, routeConnector, straightPath } from './routing.ts';
import { pathCrossesRect } from './rect.ts';

const params = { portGap: 8, clearance: 8, cornerRadius: 12 };
const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe('routeConnector', () => {
  it('keeps the straight edge-to-edge line when nothing is in the way', () => {
    const from = box(0, 0);
    const to = box(0, 200);
    const route = routeConnector(from, to, [box(300, 100)], params);
    expect(route.path).toEqual(straightPath(from, to, 8));
    expect(route.clear).toBe(true);
  });

  it('goes around an element in the way with orthogonal segments and rounded corners', () => {
    const from = box(0, 0);
    const to = box(0, 300);
    const wall = box(-20, 120, 140, 60);
    const route = routeConnector(from, to, [wall], params);
    expect(route.clear).toBe(true);
    expect(pathCrossesRect(route.path, wall)).toBe(false);
    expect(route.path.length).toBeGreaterThan(4);
    const [start] = route.path;
    const end = route.path.at(-1);
    // Leaves and enters through ports on the box sides.
    expect(start?.y === -8 || start?.y === 58 || start?.x === -8 || start?.x === 108).toBe(true);
    expect(end?.y === 292 || end?.y === 358 || end?.x === -8 || end?.x === 108).toBe(true);
  });

  it('is deterministic', () => {
    const run = () =>
      routeConnector(box(0, 0), box(400, 300), [box(150, 100), box(250, 200)], params);
    expect(run()).toEqual(run());
  });

  it('keeps the straight line and reports no clear route when every way is blocked', () => {
    const from = box(0, 0);
    const to = box(0, 300);
    const walls = [
      box(-60, 230, 220, 40),
      box(-60, 380, 220, 40),
      box(-60, 230, 40, 190),
      box(140, 230, 40, 190),
    ];
    const route = routeConnector(from, to, walls, params);
    expect(route.clear).toBe(false);
    expect(route.path).toEqual(straightPath(from, to, 8));
  });
});

describe('route helpers', () => {
  it('anchors midpoint pins on the middle of the segment holding the midpoint', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
    ];
    expect(midSegment(points)).toEqual({ point: { x: 150, y: 100 }, angle: 0 });
  });

  it('rounds inner corners and keeps both ends', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const rounded = roundCorners(points, 12);
    expect(rounded[0]).toEqual(points[0]);
    expect(rounded.at(-1)).toEqual(points[2]);
    expect(rounded).not.toContainEqual({ x: 0, y: 100 });
    expect(rounded).toContainEqual({ x: 0, y: 88 });
  });
});
