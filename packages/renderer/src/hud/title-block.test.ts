import { describe, expect, it } from 'vitest';
import { contains, intersect, listThemes, safeAreas, ThemeSchema } from '../theme/index.ts';
import { formatAreas } from '../layout/format.ts';
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
  VIEWPORT_DEFAULT_LABEL,
  viewportLabel,
} from './title-block.ts';

const cases = listThemes().flatMap((theme) =>
  TITLE_BLOCK_VARIANTS.map((variant) => [theme.id, variant, theme] as const),
);

describe.each(cases)('titleBlockLayout(%s, %s)', (_id, variant, theme) => {
  const areas = safeAreas(theme);
  const layout = titleBlockLayout(theme, variant);
  const slots = [layout.block, layout.metaRow, layout.chapterRow];
  // The strip is the full format's HUD band; the header is the card format's taller region.
  const region =
    variant === 'strip' ? areas.hudBand : (formatAreas(theme, 'card').header ?? areas.hudBand);

  it('stacks its slots inside its region without overlap', () => {
    for (const slot of slots) expect(contains(region, slot)).toBe(true);
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

  it('puts the metric and clock rows under the block in both variants', () => {
    for (const variant of ['strip', 'header'] as const) {
      const { block, metaRow, chapterRow } = titleBlockLayout(theme, variant);
      expect(metaRow.y).toBeGreaterThan(block.y + block.height);
      expect(chapterRow.y).toBeGreaterThan(metaRow.y + metaRow.height);
    }
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
    expect(() => titleBlockLayout(tiny, 'strip')).toThrow(
      /strip title block needs \d+px but the HUD band is 120px/,
    );
    expect(() => titleBlockLayout(tiny, 'header')).not.toThrow();
  });
});

describe('viewportLabel', () => {
  it('names the chapter while the chapter header is on, else DETAIL A', () => {
    expect(viewportLabel({ chapterHeader: true, chapterTitle: 'Token bucket' })).toBe(
      'Token bucket',
    );
    expect(viewportLabel({ chapterHeader: false, chapterTitle: 'Token bucket' })).toBe(
      VIEWPORT_DEFAULT_LABEL,
    );
    expect(viewportLabel({ chapterHeader: true })).toBe('DETAIL A');
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
