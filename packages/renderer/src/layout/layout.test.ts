import { describe, expect, it } from 'vitest';
import type { WorldItem } from '../scene/beat-world.ts';
import { layout } from './layout.ts';
import { LAYOUT_MODE_IDS, type LayoutModeId } from './modes.ts';
import { minReadableScale } from './readable.ts';
import { centre } from './rect.ts';
import {
  byKey,
  expectValidBoard,
  fullFrame,
  item,
  link,
  node,
  tag,
  theme,
  wideFrame,
} from './test-layout.ts';
import type { LayoutFrame } from './types.ts';

/** One representative scene per mode: the elements a beat in that mode typically has. */
const SCENES: Record<LayoutModeId, { items: WorldItem[]; focus?: string[] }> = {
  map: {
    items: [
      item('city', 'map_base', {}, 'base'),
      item('zones', 'zone_polygon', { zones: [{ id: 'north', label: 'NORTH' }] }, 'overlay'),
      tag('pickup', 'marker'),
      tag('legend', 'aside'),
    ],
  },
  two_column: {
    items: [node('a1', 'left'), node('a2', 'left'), node('b1', 'right'), node('b2', 'right')],
  },
  grid: { items: ['c1', 'c2', 'c3', 'c4', 'c5'].map((k) => tag(k, 'cell')) },
  stacked_list: {
    items: [node('r1', 'row'), node('r2', 'row'), node('r3', 'row'), tag('note', 'aside')],
  },
  centered_focus: {
    items: [node('core', 'center'), tag('t1', 'around'), tag('t2', 'around'), tag('t3', 'around')],
    focus: ['core'],
  },
  pipeline: {
    items: [
      node('in', 'source'),
      node('w1', 'stage'),
      node('w2', 'stage'),
      node('out', 'sink'),
      link('l1', 'in', 'w1'),
      link('l2', 'in', 'w2'),
      link('l3', 'w1', 'out'),
      link('l4', 'w2', 'out'),
    ],
  },
  cycle: { items: ['s1', 's2', 's3', 's4'].map((k) => tag(k, 'ring')) },
  swimlane: {
    items: [
      node('client', 'lane-1'),
      node('server', 'lane-2'),
      link('m1', 'client', 'server', 'message'),
      link('m2', 'server', 'client', 'message'),
    ],
  },
  versus_split: {
    items: [node('before', 'left'), node('after', 'right'), tag('same', 'shared')],
  },
  near_far: {
    items: [node('client', 'origin'), node('cache', 'near'), node('db', 'far')],
  },
  hub_spoke: {
    items: [node('hub', 'hub'), ...['s1', 's2', 's3', 's4'].map((k) => tag(k, 'spoke'))],
  },
};

const FRAMES: [string, () => LayoutFrame][] = [
  ['full', () => fullFrame()],
  ['wide', () => wideFrame()],
];

describe.each(FRAMES)('layout in a %s frame', (_name, makeFrame) => {
  it.each(LAYOUT_MODE_IDS)('%s: no overlaps, inside the frame, clear of avoid zones', (mode) => {
    const frame = makeFrame();
    const scene = SCENES[mode];
    const result = layout({ items: scene.items, mode, focus: scene.focus ?? [] }, theme, frame);
    expect(result.mode).toBe(mode);
    expectValidBoard(result, frame);
    const placedKeys = result.items.map((i) => i.key);
    const expected = scene.items.filter((i) => i.key[0] !== 'l' && i.key[0] !== 'm');
    for (const i of expected) expect(placedKeys).toContain(i.key);
  });
});

describe('layout modes', () => {
  it('draws the focus element largest and in the middle (centered_focus)', () => {
    const scene = SCENES.centered_focus;
    const result = layout(
      { items: scene.items, mode: 'centered_focus', focus: ['core'] },
      theme,
      fullFrame(),
    );
    const core = byKey(result, 'core');
    for (const other of result.items.filter((i) => i.key !== 'core')) {
      expect(core.scale).toBeGreaterThan(other.scale);
    }
    const c = centre(core.rect);
    const others = result.items.filter((i) => i.key !== 'core').map((i) => centre(i.rect).y);
    expect(Math.min(...others)).toBeLessThan(c.y);
    expect(Math.max(...others)).toBeGreaterThan(c.y);
  });

  it('boosts a focus element in any mode', () => {
    const items = [node('a', 'row'), node('b', 'row')];
    const result = layout({ items, mode: 'stacked_list', focus: ['b'] }, theme, fullFrame());
    expect(byKey(result, 'b').scale).toBeGreaterThan(byKey(result, 'a').scale);
  });

  it('runs a pipeline top-down in a tall frame and left-right in a wide one', () => {
    const { items } = SCENES.pipeline;
    const tall = layout({ items, mode: 'pipeline', focus: [] }, theme, fullFrame());
    const order = ['in', 'w1', 'out'].map((k) => centre(byKey(tall, k).rect));
    expect(order[0]!.y).toBeLessThan(order[1]!.y);
    expect(order[1]!.y).toBeLessThan(order[2]!.y);
    expect(centre(byKey(tall, 'w1').rect).y).toBeCloseTo(centre(byKey(tall, 'w2').rect).y);
    const wide = layout({ items, mode: 'pipeline', focus: [] }, theme, wideFrame());
    const across = ['in', 'w1', 'out'].map((k) => centre(byKey(wide, k).rect).x);
    expect(across[0]!).toBeLessThan(across[1]!);
    expect(across[1]!).toBeLessThan(across[2]!);
  });

  it('ranks a serial pipeline by its connectors', () => {
    const items = [
      node('a', 'stage'),
      node('b', 'stage'),
      node('c', 'stage'),
      link('ab', 'a', 'b'),
      link('bc', 'b', 'c'),
    ];
    const result = layout({ items, mode: 'pipeline', focus: [] }, theme, fullFrame());
    const ys = ['a', 'b', 'c'].map((k) => centre(byKey(result, k).rect).y);
    expect(ys[0]!).toBeLessThan(ys[1]!);
    expect(ys[1]!).toBeLessThan(ys[2]!);
  });

  it('draws the far destination at least three times as far as the near one', () => {
    const result = layout(
      { items: SCENES.near_far.items, mode: 'near_far', focus: [] },
      theme,
      fullFrame(),
    );
    const [o, n, f] = ['client', 'cache', 'db'].map((k) => centre(byKey(result, k).rect));
    const near = Math.abs(n!.y - o!.y);
    const far = Math.abs(f!.y - o!.y);
    expect(far / near).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(Math.sign(n!.y - o!.y)).toBe(-Math.sign(f!.y - o!.y));
  });

  it('frames map overlays on the map base', () => {
    const result = layout({ items: SCENES.map.items, mode: 'map', focus: [] }, theme, fullFrame());
    expect(byKey(result, 'zones').rect).toEqual(byKey(result, 'city').rect);
    expect(byKey(result, 'zones').z).toBeGreaterThan(byKey(result, 'city').z);
  });

  it('draws swimlane lifelines and a divider between versus halves', () => {
    const lanes = layout(
      { items: SCENES.swimlane.items, mode: 'swimlane', focus: [] },
      theme,
      fullFrame(),
    );
    expect(lanes.guides).toHaveLength(2);
    for (const g of lanes.guides) expect(g.from.x).toBeCloseTo(g.to.x);
    const versus = layout(
      { items: SCENES.versus_split.items, mode: 'versus_split', focus: [] },
      theme,
      fullFrame(),
    );
    expect(versus.guides).toHaveLength(1);
    const divider = versus.guides[0]!.from.x;
    expect(centre(byKey(versus, 'before').rect).x).toBeLessThan(divider);
    expect(centre(byKey(versus, 'after').rect).x).toBeGreaterThan(divider);
  });

  it('puts the cycle steps on a ring, clockwise from the top', () => {
    const result = layout(
      { items: SCENES.cycle.items, mode: 'cycle', focus: [] },
      theme,
      fullFrame(),
    );
    const [top, rightStep, bottomStep, leftStep] = ['s1', 's2', 's3', 's4'].map((k) =>
      centre(byKey(result, k).rect),
    );
    expect(top!.y).toBeLessThan(rightStep!.y);
    expect(rightStep!.x).toBeGreaterThan(leftStep!.x);
    expect(bottomStep!.y).toBeGreaterThan(rightStep!.y);
  });
});

describe('layout warnings', () => {
  it('warns when a scene has more elements than its mode holds', () => {
    const items = Array.from({ length: 8 }, (_, i) => tag(`t${i}`, 'row'));
    const result = layout({ items, mode: 'stacked_list', focus: [] }, theme, fullFrame());
    expect(result.warnings.map((w) => w.code)).toContain('too_many_elements');
    expectValidBoard(result, fullFrame());
  });

  it('warns when the board only fits below the readable scale', () => {
    const items = Array.from({ length: 6 }, (_, i) => node(`n${i}`, 'left'));
    const result = layout({ items, mode: 'two_column', focus: [] }, theme, wideFrame());
    expect(result.scale).toBeLessThan(minReadableScale(theme));
    expect(result.warnings.map((w) => w.code)).toContain('text_too_small');
  });

  it('warns about unknown zones and modes, and still lays out', () => {
    const result = layout(
      { items: [tag('a', 'nowhere')], mode: 'spiral', focus: [] },
      theme,
      fullFrame(),
    );
    expect(result.warnings.map((w) => w.code)).toEqual(['unknown_layout_mode', 'unknown_zone']);
    expect(result.items).toHaveLength(1);
  });

  it('keeps tall right-hand elements out of the avoid zone', () => {
    const frame = fullFrame();
    expect(frame.avoidZones.length).toBeGreaterThan(0);
    const items = [
      item('phone', 'device_frame', { status: 'login' }, 'right'),
      node('left', 'left'),
    ];
    const result = layout({ items, mode: 'two_column', focus: [] }, theme, frame);
    expectValidBoard(result, frame);
    expect(result.warnings.map((w) => w.code)).not.toContain('avoid_zone');
  });
});

describe('determinism', () => {
  it('gives identical output for identical input', () => {
    for (const mode of LAYOUT_MODE_IDS) {
      const scene = SCENES[mode];
      const run = () =>
        layout({ items: scene.items, mode, focus: scene.focus ?? [] }, theme, fullFrame());
      expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    }
  });
});
