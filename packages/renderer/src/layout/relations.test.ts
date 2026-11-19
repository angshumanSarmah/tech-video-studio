import { describe, expect, it } from 'vitest';
import { pointAlong, type Point } from '../primitives/geometry.ts';
import type { PinSide } from '../primitives/types.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { layout } from './layout.ts';
import { bottom, centre, inflate, inside, right } from './rect.ts';
import {
  byKey,
  canvasPath,
  expectValidBoard,
  fullFrame,
  item,
  link,
  node,
  tag,
  theme,
  wideFrame,
} from './test-layout.ts';
import type { BoardLayout, PlacedItem } from './types.ts';

const pinned = (key: string, to: string, side: PinSide) =>
  tag(key, undefined, { pin: { to, side } });

/** Where a pin sits relative to its host, in host-scaled px: the gap and the centre offset. */
function attachment(layout: BoardLayout, key: string, host: string, side: PinSide) {
  const p = byKey(layout, key).rect;
  const h = byKey(layout, host).rect;
  const scale = layout.scale;
  const cp = centre(p);
  const ch = centre(h);
  switch (side) {
    case 'top':
      return { gap: (h.y - bottom(p)) / scale, offset: cp.x - ch.x };
    case 'bottom':
      return { gap: (p.y - bottom(h)) / scale, offset: cp.x - ch.x };
    case 'left':
      return { gap: (h.x - right(p)) / scale, offset: cp.y - ch.y };
    default:
      return { gap: (p.x - right(h)) / scale, offset: cp.y - ch.y };
  }
}

describe('pins', () => {
  const SIDES: PinSide[] = ['top', 'bottom', 'left', 'right'];

  it.each(SIDES)('keeps a %s pin attached when its host moves between beats', (side) => {
    const before: WorldItem[] = [node('in', 'source'), node('db', 'sink'), link('l1', 'in', 'db')];
    const after: WorldItem[] = [
      node('in', 'source'),
      node('cache', 'stage'),
      node('db', 'sink'),
      link('l1', 'in', 'cache'),
      link('l2', 'cache', 'db'),
    ];
    const one = layout(
      { items: [...before, pinned('hot', 'db', side)], mode: 'pipeline', focus: [] },
      theme,
      fullFrame(),
    );
    const two = layout(
      { items: [...after, pinned('hot', 'db', side)], mode: 'pipeline', focus: [] },
      theme,
      fullFrame(),
    );
    expect(centre(byKey(one, 'db').rect)).not.toEqual(centre(byKey(two, 'db').rect));
    for (const result of [one, two]) {
      expectValidBoard(result, fullFrame());
      const { gap, offset } = attachment(result, 'hot', 'db', side);
      expect(gap).toBeCloseTo(theme.space.xs, 5);
      expect(offset).toBeCloseTo(0, 5);
    }
  });

  it('reserves room for pins, so they never overlap the neighbours', () => {
    const items = [node('a', 'row'), pinned('ta', 'a', 'bottom'), node('b', 'row')];
    const result = layout({ items, mode: 'stacked_list', focus: [] }, theme, fullFrame());
    expectValidBoard(result, fullFrame());
  });

  it('pins to a connector midpoint', () => {
    const items = [
      node('a', 'source'),
      node('b', 'sink'),
      link('ab', 'a', 'b'),
      pinned('hit', 'ab', 'middle'),
    ];
    for (const frame of [fullFrame(), wideFrame()]) {
      const result = layout({ items, mode: 'pipeline', focus: [] }, theme, frame);
      const mid = pointAlong(canvasPath(byKey(result, 'ab')), 0.5).point;
      const c = centre(byKey(result, 'hit').rect);
      expect(c.x).toBeCloseTo(mid.x, 5);
      expect(c.y).toBeCloseTo(mid.y, 5);
      expectValidBoard(result, frame);
    }
  });

  it('chains pins and drops pin cycles with a warning', () => {
    const chain = [node('a', 'row'), pinned('t1', 'a', 'right'), pinned('t2', 't1', 'bottom')];
    const ok = layout({ items: chain, mode: 'stacked_list', focus: [] }, theme, fullFrame());
    expect(attachment(ok, 't2', 't1', 'bottom').gap).toBeCloseTo(theme.space.xs, 5);
    const cycle = [pinned('x', 'y', 'top'), pinned('y', 'x', 'top')];
    const bad = layout({ items: cycle, mode: 'stacked_list', focus: [] }, theme, fullFrame());
    expect(bad.warnings.filter((w) => w.code === 'pin_unresolved')).toHaveLength(2);
    expectValidBoard(bad, fullFrame());
  });

  it('warns about a pin whose host is not on the board', () => {
    const result = layout(
      { items: [pinned('t', 'ghost', 'top')], mode: 'stacked_list', focus: [] },
      theme,
      fullFrame(),
    );
    expect(result.warnings.map((w) => w.code)).toEqual(['pin_unresolved']);
    expect(byKey(result, 't').role).toBe('solid');
  });
});

describe('relational items', () => {
  const ends = (p: PlacedItem): [Point, Point] => {
    const path = canvasPath(p);
    const first = path[0];
    const last = path.at(-1);
    if (!first || !last) throw new Error(`${p.key} has no path`);
    return [first, last];
  };

  it('runs connectors from edge to edge of their ends', () => {
    const items = [node('a', 'source'), node('b', 'sink'), link('ab', 'a', 'b')];
    const result = layout({ items, mode: 'pipeline', focus: [] }, theme, fullFrame());
    const [start, end] = ends(byKey(result, 'ab'));
    const pad = (theme.space.xs + 1) * result.scale;
    const from = byKey(result, 'a').rect;
    const to = byKey(result, 'b').rect;
    expect(inside(inflate(from, pad), { ...start, width: 0, height: 0 })).toBe(true);
    expect(inside(inflate(to, pad), { ...end, width: 0, height: 0 })).toBe(true);
    expect(inside(from, { ...start, width: 0, height: 0 }, -1)).toBe(false);
  });

  it('sends a packet stream along its connector', () => {
    const items = [
      node('a', 'source'),
      node('b', 'sink'),
      link('ab', 'a', 'b'),
      item('flow', 'packet_stream', { along: 'ab' }),
    ];
    const result = layout({ items, mode: 'pipeline', focus: [] }, theme, fullFrame());
    expect(canvasPath(byKey(result, 'flow'))).toEqual(canvasPath(byKey(result, 'ab')));
  });

  it('routes swimlane messages horizontally between lifelines, in order', () => {
    const items = [
      node('c', 'lane-1'),
      node('s', 'lane-2'),
      link('m1', 'c', 's', 'message'),
      link('m2', 's', 'c', 'message'),
    ];
    const result = layout({ items, mode: 'swimlane', focus: [] }, theme, fullFrame());
    const [a1, b1] = ends(byKey(result, 'm1'));
    const [a2] = ends(byKey(result, 'm2'));
    expect(a1.y).toBeCloseTo(b1.y);
    expect(a1.x).toBeLessThan(b1.x);
    expect(a2.y).toBeGreaterThan(a1.y);
    expect(a1.x).toBeCloseTo(result.guides[0]!.from.x);
  });

  it('frames a grid over its target and rings an element', () => {
    const items = [
      item('city', 'map_base', {}, 'center'),
      item('grid', 'grid_overlay', { rows: 3, cols: 3, over: 'city' }),
      node('depot', 'around'),
      item('reach', 'radius_ring', { around: 'depot' }),
    ];
    const result = layout({ items, mode: 'centered_focus', focus: [] }, theme, fullFrame());
    expect(byKey(result, 'grid').rect).toEqual(byKey(result, 'city').rect);
    const ring = byKey(result, 'reach').rect;
    const depot = byKey(result, 'depot').rect;
    expect(inside(ring, depot)).toBe(true);
    expect(centre(ring).x).toBeCloseTo(centre(depot).x);
  });

  it('spans a bracket under its targets', () => {
    const items = [
      tag('a', 'cell'),
      tag('b', 'cell'),
      tag('c', 'cell'),
      item('group', 'bracket', { targets: ['a', 'b'], label: 'PAIR' }),
    ];
    const result = layout({ items, mode: 'grid', focus: [] }, theme, fullFrame());
    const brace = byKey(result, 'group').rect;
    for (const k of ['a', 'b'])
      expect(brace.y).toBeGreaterThanOrEqual(bottom(byKey(result, k).rect));
    expectValidBoard(result, fullFrame());
  });

  it('warns when a connector passes through another element', () => {
    const items = [node('a', 'row'), node('b', 'row'), node('c', 'row'), link('ac', 'a', 'c')];
    const result = layout({ items, mode: 'stacked_list', focus: [] }, theme, fullFrame());
    const crossing = result.warnings.filter((w) => w.code === 'connector_crosses');
    expect(crossing).toEqual([expect.objectContaining({ keys: ['ac', 'b'] })]);
  });
});

describe('containers', () => {
  it('lays out an inset panel’s children inside it and sizes it from them', () => {
    const child = item('detail', 'data_block', {
      title: 'ROW',
      fields: [{ key: 'id', value: '7' }],
    });
    const panel: WorldItem = {
      ...item('zoom', 'inset_panel', { title: 'DETAIL', children: ['detail'] }),
      children: [child],
    };
    const result = layout(
      { items: [panel], mode: 'centered_focus', focus: [] },
      theme,
      fullFrame(),
    );
    const placed = byKey(result, 'zoom');
    const box = {
      x: 0,
      y: 0,
      width: placed.rect.width / placed.scale,
      height: placed.rect.height / placed.scale,
    };
    expect(placed.children).toHaveLength(1);
    expect(inside(box, placed.children![0]!.rect)).toBe(true);
    expectValidBoard(result, fullFrame());
  });
});
