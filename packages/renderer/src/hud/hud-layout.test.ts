import { describe, expect, it } from 'vitest';
import { contains, intersect, listThemes, safeAreas, ThemeSchema } from '../theme/index.ts';
import { blueprintDark } from '../theme/themes/blueprint-dark.ts';
import { hudLayout, lineHeightPx } from './hud-layout.ts';

describe.each(listThemes().map((t) => [t.id, t] as const))('hudLayout(%s)', (_id, theme) => {
  const areas = safeAreas(theme);
  const layout = hudLayout(theme);
  const rows = [layout.topBar, layout.metaRow, layout.chapterRow];

  it('stacks the rows inside the HUD band without overlap', () => {
    for (const row of rows) expect(contains(areas.hudBand, row)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      const [above, below] = [rows[i - 1], rows[i]];
      if (!above || !below) throw new Error('missing row');
      expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);
    }
  });

  it('keeps every slot clear of the platform UI', () => {
    for (const slot of [...rows, layout.headline]) {
      for (const zone of areas.exclusionZones) expect(intersect(slot, zone)).toBeNull();
    }
  });

  it('fits two headline lines in the headline band', () => {
    expect(layout.headline).toEqual(areas.headlineBand);
    expect(2 * lineHeightPx(theme, 'headline')).toBeLessThanOrEqual(layout.headline.height);
  });
});

describe('hudLayout geometry', () => {
  it('follows the HUD band when the top bar zones move', () => {
    const platforms = structuredClone(blueprintDark.safeArea.platforms);
    for (const zones of Object.values(platforms)) zones.topBar.height -= 60;
    const moved = ThemeSchema.parse({
      ...blueprintDark,
      safeArea: { ...blueprintDark.safeArea, platforms },
    });
    const before = hudLayout(ThemeSchema.parse(blueprintDark));
    const after = hudLayout(moved);
    expect(after.topBar.y).toBe(before.topBar.y - 60);
    expect(after.headline.y).toBe(before.headline.y - 60);
  });

  it('throws when the HUD band is too short for the rows', () => {
    const tiny = ThemeSchema.parse({
      ...blueprintDark,
      safeArea: { ...blueprintDark.safeArea, hudBand: 80 },
    });
    expect(() => hudLayout(tiny)).toThrow(/HUD needs \d+px but the HUD band is 80px/);
  });
});
