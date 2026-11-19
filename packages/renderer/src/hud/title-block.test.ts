import { describe, expect, it } from 'vitest';
import { contains, intersect, listThemes, safeAreas, ThemeSchema } from '../theme/index.ts';
import { draftingPaper } from '../theme/themes/drafting-paper.ts';
import { lineHeightPx } from './hud-layout.ts';
import {
  cellHeight,
  sheetLabel,
  TITLE_BLOCK_VARIANTS,
  TITLE_LINES,
  titleBlockCells,
  titleBlockLayout,
  topCellHeight,
} from './title-block.ts';

const cases = listThemes().flatMap((theme) =>
  TITLE_BLOCK_VARIANTS.map((variant) => [theme.id, variant, theme] as const),
);

describe.each(cases)('titleBlockLayout(%s, %s)', (_id, variant, theme) => {
  const areas = safeAreas(theme);
  const layout = titleBlockLayout(theme, variant);
  const slots = [layout.block, layout.metaRow, layout.clockRow].flatMap((r) => (r ? [r] : []));

  it('stacks its slots inside the HUD band without overlap', () => {
    for (const slot of slots) expect(contains(areas.hudBand, slot)).toBe(true);
    for (let i = 1; i < slots.length; i++) {
      const [above, below] = [slots[i - 1], slots[i]];
      if (!above || !below) throw new Error('missing slot');
      expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);
    }
  });

  it('keeps every slot clear of the platform UI', () => {
    for (const slot of slots) {
      for (const zone of areas.exclusionZones) expect(intersect(slot, zone)).toBeNull();
    }
  });

  it('holds the top cell and a row of cells inside the border', () => {
    const inner = layout.block.height - 2 * theme.stroke.thin;
    expect(layout.topHeight + cellHeight(theme)).toBeLessThanOrEqual(inner);
  });
});

describe('titleBlockLayout variants', () => {
  const theme = ThemeSchema.parse(draftingPaper);

  it('gives the strip the metric and clock rows, and the header only the block', () => {
    const strip = titleBlockLayout(theme, 'strip');
    const header = titleBlockLayout(theme, 'header');
    expect(strip.metaRow).not.toBeNull();
    expect(strip.clockRow).not.toBeNull();
    expect(header.metaRow).toBeNull();
    expect(header.clockRow).toBeNull();
  });

  it('reserves two title lines in the header, one HUD line in the strip', () => {
    expect(topCellHeight(theme, 'header')).toBeGreaterThanOrEqual(
      TITLE_LINES * lineHeightPx(theme, 'title'),
    );
    expect(topCellHeight(theme, 'strip')).toBe(cellHeight(theme) + theme.stroke.hairline);
  });

  it('throws when the HUD band is too short', () => {
    const tiny = ThemeSchema.parse({
      ...draftingPaper,
      safeArea: { ...draftingPaper.safeArea, hudBand: 120 },
    });
    expect(() => titleBlockLayout(tiny, 'header')).toThrow(
      /header title block needs \d+px but the HUD band is 120px/,
    );
  });
});

describe('titleBlockCells', () => {
  it('lists SHEET, REV and the handle under the strip subject', () => {
    expect(
      titleBlockCells({ variant: 'strip', sheet: true, channelHandle: '@example-handle' }),
    ).toEqual(['sheet', 'revision', 'handle']);
  });

  it('names the series in the header, below the title', () => {
    expect(
      titleBlockCells({ variant: 'header', sheet: true, channelHandle: '@example-handle' }),
    ).toEqual(['series', 'sheet', 'revision', 'handle']);
  });

  it('drops SHEET without a step tracker and the handle without a channel', () => {
    expect(titleBlockCells({ variant: 'strip', sheet: false, channelHandle: null })).toEqual([
      'revision',
    ]);
  });
});

describe('sheetLabel', () => {
  it('counts sheets from 1', () => {
    expect(sheetLabel(0, 3)).toBe('SHEET 1/3');
    expect(sheetLabel(2, 3)).toBe('SHEET 3/3');
  });
});
