import { describe, expect, it } from 'vitest';
import { getTheme } from '../../theme/index.ts';
import { routePathPrimitive, RoutePathPropsSchema } from './definition.ts';
import { ROUTE_DRAW_SEC, routeDraw, routeLayout } from './route.ts';

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
