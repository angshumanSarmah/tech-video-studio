import { describe, expect, it } from 'vitest';
import { listThemes } from './registry.ts';
import { safeAreas, unionInsets, type Rect } from './safe-area.ts';
import { PLATFORMS } from './schema.ts';

const bottom = (r: Rect) => r.y + r.height;
const right = (r: Rect) => r.x + r.width;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  right(inner) <= right(outer) &&
  bottom(inner) <= bottom(outer);

describe.each(listThemes().map((t) => [t.id, t] as const))('safeAreas(%s)', (_id, theme) => {
  const areas = safeAreas(theme);

  it('clears every platform margin', () => {
    for (const platform of PLATFORMS) {
      const m = theme.safeArea.platforms[platform];
      expect(areas.platformSafe.x).toBeGreaterThanOrEqual(m.left);
      expect(areas.platformSafe.y).toBeGreaterThanOrEqual(m.top);
      expect(theme.canvas.width - right(areas.platformSafe)).toBeGreaterThanOrEqual(m.right);
      expect(theme.canvas.height - bottom(areas.platformSafe)).toBeGreaterThanOrEqual(m.bottom);
    }
    expect(contains(areas.canvas, areas.platformSafe)).toBe(true);
  });

  it('stacks HUD band, stage and subtitle band inside the platform-safe area without overlap', () => {
    const { hudBand, stage, subtitleBand, platformSafe } = areas;
    for (const r of [hudBand, stage, subtitleBand]) {
      expect(contains(platformSafe, r)).toBe(true);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
    expect(stage.y - bottom(hudBand)).toBe(theme.safeArea.gap);
    expect(subtitleBand.y - bottom(stage)).toBe(theme.safeArea.gap);
    expect(hudBand.y).toBe(platformSafe.y);
    expect(bottom(subtitleBand)).toBe(bottom(platformSafe));
  });

  it('leaves a usable stage (at least half the canvas width and a third of its height)', () => {
    expect(areas.stage.width).toBeGreaterThanOrEqual(theme.canvas.width / 2);
    expect(areas.stage.height).toBeGreaterThanOrEqual(theme.canvas.height / 3);
  });

  it('takes the largest margin per side', () => {
    const union = unionInsets(theme);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(union[side]).toBe(
        Math.max(...PLATFORMS.map((p) => theme.safeArea.platforms[p][side])),
      );
    }
  });
});
