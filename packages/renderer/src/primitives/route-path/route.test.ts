import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { routePathPrimitive, RoutePathPropsSchema } from './definition.ts';
import {
  excessMoves,
  HOP_SEC,
  ROUTE_DRAW_SEC,
  routeDraw,
  routeLayout,
  routeView,
} from './route.ts';
import { routePathEventWarnings } from './definition.ts';

const box = { width: 800, height: 600 };
const inset = { x: 50, y: 60 };

describe('routeLayout', () => {
  it('spreads stops left to right inside the inset box', () => {
    const { stops } = routeLayout(4, box, inset);
    const xs = stops.map((s) => s.x);
    expect(xs[0]).toBe(50);
    expect(xs[3]).toBe(750);
    for (let i = 1; i < xs.length; i += 1)
      expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeCloseTo(700 / 3);
    for (const s of stops) {
      expect(s.y).toBeGreaterThanOrEqual(inset.y);
      expect(s.y).toBeLessThanOrEqual(box.height - inset.y);
    }
  });

  it('joins stops with horizontal-then-vertical legs that pass through every stop', () => {
    const { stops, path } = routeLayout(3, box, inset);
    expect(path[0]).toBe(stops[0]);
    expect(path.at(-1)).toBe(stops[2]);
    for (const stop of stops) expect(path).toContain(stop);
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      expect(a?.x === b?.x || a?.y === b?.y).toBe(true);
    }
  });

  it('reaches the first stop at 0, the last at 1, and the others in between, in order', () => {
    const { stopAt } = routeLayout(5, box, inset);
    expect(stopAt[0]).toBe(0);
    expect(stopAt.at(-1)).toBeCloseTo(1);
    expect(stopAt).toEqual([...stopAt].sort((a, b) => a - b));
    expect(stopAt).toHaveLength(5);
  });
});

describe('labelAbove', () => {
  it('puts each label on the side the route does not arrive from', () => {
    const { stops, labelAbove } = routeLayout(4, box, inset);
    expect(labelAbove[0]).toBe(false);
    stops.forEach((stop, i) => {
      const prev = stops[i - 1];
      if (prev) expect(labelAbove[i]).toBe(prev.y > stop.y);
    });
    expect(labelAbove).toContain(true);
    expect(labelAbove.slice(1)).toContain(false);
  });
});

describe('routeDraw', () => {
  it('is drawn without a move, and draws over a fixed time after one', () => {
    expect(routeDraw(undefined)).toBe(1);
    expect(routeDraw(0)).toBe(0);
    expect(routeDraw(ROUTE_DRAW_SEC / 2)).toBeCloseTo(0.5);
    expect(routeDraw(ROUTE_DRAW_SEC * 2)).toBe(1);
  });
});

describe('route_path props', () => {
  it('rejects duplicate stop ids and exposes stops as parts', () => {
    const dup = { stops: [{ id: 'a' }, { id: 'a' }] };
    const result = RoutePathPropsSchema.safeParse(dup);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['stops', 1, 'id']);
    const props = RoutePathPropsSchema.parse({ stops: [{ id: 'a' }, { id: 'b' }] });
    expect(routePathPrimitive.parts?.ids(props)).toEqual(['a', 'b']);
  });

  it('fits the stop labels side by side', () => {
    const stops = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: 'a long place' }));
    const hints = routePathPrimitive.sizeHints(RoutePathPropsSchema.parse({ stops }), getTheme());
    expect(hints.minWidth).toBeGreaterThan(600);
  });
});

describe('routeView', () => {
  const layout = routeLayout(3, box, inset);
  const expectAt = (actual: { x: number; y: number } | undefined, expected: unknown) => {
    const e = expected as { x: number; y: number };
    expect(actual?.x).toBeCloseTo(e.x);
    expect(actual?.y).toBeCloseTo(e.y);
  };
  const still = { moveElapsed: undefined, moves: 0, morphElapsed: undefined };

  it('keeps street mode as before: fully drawn without move, the mover at the end', () => {
    const view = routeView(layout, undefined, still);
    expect(view.draw).toBe(1);
    expectAt(view.line.at(-1), layout.stops[2]);
    expectAt(view.mover, layout.stops[2]);
  });

  it('draws a smooth curve on move with the mover at its head', () => {
    const view = routeView(layout, 'smooth', {
      ...still,
      moveElapsed: ROUTE_DRAW_SEC / 2,
      moves: 1,
    });
    expect(view.draw).toBeCloseTo(0.5);
    expectAt(view.mover, view.line.at(-1));
    expect(view.trail).toEqual([]);
  });

  it('jumpy: the mover waits at the first stop, then hops one stop per move', () => {
    expect(routeView(layout, 'jumpy', still)).toMatchObject({
      mover: layout.stops[0],
      line: [],
      trail: [],
      reached: [true, false, false],
    });
    const hopping = routeView(layout, 'jumpy', { ...still, moves: 1, moveElapsed: HOP_SEC / 2 });
    expect(hopping.mover?.x).toBeGreaterThan(layout.stops[0]?.x ?? 0);
    expect(hopping.mover?.x).toBeLessThan(layout.stops[1]?.x ?? 0);
    const landed = routeView(layout, 'jumpy', { ...still, moves: 2, moveElapsed: HOP_SEC });
    expect(landed.mover).toEqual(layout.stops[2]);
    expect(landed.reached).toEqual([true, true, true]);
    expect(landed.trail).toHaveLength(3);
  });

  it('jumpy: extra moves keep the mover at the last stop', () => {
    const view = routeView(layout, 'jumpy', { ...still, moves: 5, moveElapsed: 0 });
    expect(view.mover).toEqual(layout.stops[2]);
  });

  it('jumpy: morph draws the curve, the mover glides from the start and the hops fade', () => {
    const jumped = { moves: 2, moveElapsed: 3 };
    const start = routeView(layout, 'jumpy', { ...jumped, morphElapsed: 0 });
    expectAt(start.mover, layout.stops[0]);
    expect(start.trailOpacity).toBe(1);
    const mid = routeView(layout, 'jumpy', { ...jumped, morphElapsed: ROUTE_DRAW_SEC / 2 });
    expect(mid.line.length).toBeGreaterThan(2);
    expect(mid.trailOpacity).toBeCloseTo(0.5);
    const done = routeView(layout, 'jumpy', { ...jumped, morphElapsed: ROUTE_DRAW_SEC });
    expectAt(done.mover, layout.stops[2]);
    expect(done.trailOpacity).toBe(0);
  });
});

describe('route_moves_exceed_stops', () => {
  const props = RoutePathPropsSchema.parse({
    stops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    mode: 'jumpy',
  });
  const moves = (n: number) => Array.from({ length: n }, () => ({ action: 'move' as const }));

  it('counts moves past the last stop', () => {
    expect(excessMoves(3, 2)).toBe(0);
    expect(excessMoves(3, 4)).toBe(2);
  });

  it('warns a jumpy route with more moves than hops, ignoring part events and other modes', () => {
    expect(routePathEventWarnings(props, moves(2))).toEqual([]);
    expect(routePathEventWarnings(props, [...moves(2), { action: 'move', parts: ['b'] }])).toEqual(
      [],
    );
    expect(routePathEventWarnings(props, moves(3))).toMatchObject([
      { code: 'route_moves_exceed_stops' },
    ]);
    expect(routePathEventWarnings({ ...props, mode: 'smooth' }, moves(3))).toEqual([]);
  });
});
