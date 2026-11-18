import { describe, expect, it } from 'vitest';
import { buildThemeRegistry, listThemes } from './registry.ts';
import {
  clearSymmetric,
  clipZones,
  contains,
  intersect,
  safeAreas,
  type Rect,
  type Zone,
} from './safe-area.ts';
import { ThemeSchema } from './schema.ts';
import { blueprintDark } from './themes/blueprint-dark.ts';

const bottom = (r: Rect) => r.y + r.height;
const centreX = (r: Rect) => r.x + r.width / 2;

describe.each(listThemes().map((t) => [t.id, t] as const))('safeAreas(%s)', (_id, theme) => {
  const areas = safeAreas(theme);
  const { hudBand, stage, subtitleBand } = areas;

  it('keeps both bands clear of every exclusion zone', () => {
    for (const zone of areas.exclusionZones) {
      expect(intersect(hudBand, zone), `hudBand vs ${zone.id}`).toBeNull();
      expect(intersect(subtitleBand, zone), `subtitleBand vs ${zone.id}`).toBeNull();
    }
  });

  it('centres the bands and the stage on the canvas', () => {
    for (const r of [hudBand, stage, subtitleBand]) {
      expect(centreX(r)).toBe(theme.canvas.width / 2);
      expect(contains(areas.canvas, r)).toBe(true);
    }
    expect(stage.x).toBe(theme.safeArea.gutter);
  });

  it('stacks HUD band, stage and subtitle band with no gaps or overlap', () => {
    expect(stage.y).toBe(bottom(hudBand));
    expect(subtitleBand.y).toBe(bottom(stage));
    expect(hudBand.height).toBe(theme.safeArea.hudBand);
    expect(subtitleBand.height).toBe(theme.safeArea.subtitleBand);
  });

  it('places the bands against the union top bar and bottom info', () => {
    const tops = areas.exclusionZones.filter((z) => z.id.endsWith('.topBar'));
    const bottoms = areas.exclusionZones.filter((z) => z.id.endsWith('.bottomInfo'));
    expect(hudBand.y).toBe(Math.max(...tops.map(bottom)));
    expect(bottom(subtitleBand)).toBe(Math.min(...bottoms.map((z) => z.y)));
  });

  it('reports avoid zones inside the stage, none contained in another', () => {
    for (const zone of areas.avoidZones) {
      expect(contains(stage, zone)).toBe(true);
      for (const other of areas.avoidZones) {
        if (other !== zone) expect(contains(other, zone)).toBe(false);
      }
    }
  });
});

describe('blueprint-dark safe areas', () => {
  const areas = safeAreas(ThemeSchema.parse(blueprintDark));

  it('derives the planned geometry from the starting zones', () => {
    expect(areas.hudBand).toEqual({ x: 48, y: 220, width: 984, height: 200 });
    expect(areas.stage).toEqual({ x: 48, y: 420, width: 984, height: 900 });
    // Narrowed on both sides to clear the action buttons (x >= 930) and stay centred.
    expect(areas.subtitleBand).toEqual({ x: 150, y: 1320, width: 780, height: 180 });
    // reels.actions clips to a rect inside shorts.actions, so only one remains.
    expect(areas.avoidZones).toEqual([
      { id: 'shorts.actions', x: 930, y: 900, width: 102, height: 420 },
    ]);
  });
});

describe('geometry helpers', () => {
  const r = (x: number, y: number, width: number, height: number): Rect => ({
    x,
    y,
    width,
    height,
  });

  it('intersect returns the overlap, or null when rects only touch', () => {
    expect(intersect(r(0, 0, 10, 10), r(5, 5, 10, 10))).toEqual(r(5, 5, 5, 5));
    expect(intersect(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBeNull();
  });

  it('clearSymmetric narrows both sides by the deepest overlapping zone', () => {
    const band = r(48, 100, 984, 50);
    expect(clearSymmetric(band, [r(930, 0, 150, 200)], 1080)).toEqual(r(150, 100, 780, 50));
    expect(clearSymmetric(band, [r(0, 0, 200, 200)], 1080)).toEqual(r(200, 100, 680, 50));
    expect(clearSymmetric(band, [r(930, 500, 150, 200)], 1080)).toEqual(band);
  });

  it('clipZones drops zones outside the area and zones contained in another', () => {
    const zones: Zone[] = [
      { id: 'a', ...r(900, 0, 200, 200) },
      { id: 'b', ...r(950, 50, 100, 50) },
      { id: 'c', ...r(0, 500, 10, 10) },
      { id: 'd', ...r(900, 0, 200, 200) },
    ];
    expect(clipZones(zones, r(0, 0, 1000, 300))).toEqual([{ id: 'a', ...r(900, 0, 100, 200) }]);
  });
});

describe('safe-area validation', () => {
  it('rejects a zone outside the canvas', () => {
    const shorts = blueprintDark.safeArea.platforms.shorts;
    const bad = {
      ...blueprintDark,
      safeArea: {
        ...blueprintDark.safeArea,
        platforms: {
          ...blueprintDark.safeArea.platforms,
          shorts: { ...shorts, actions: { ...shorts.actions, x: 1000 } },
        },
      },
    };
    const result = ThemeSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['safeArea', 'platforms', 'shorts', 'actions']);
  });

  it('rejects a theme whose zones leave no stage', () => {
    const cramped = {
      ...blueprintDark,
      id: 'cramped',
      safeArea: { ...blueprintDark.safeArea, hudBand: 700, subtitleBand: 700 },
    };
    expect(() => buildThemeRegistry([cramped])).toThrow(/stage is empty/);
  });
});
