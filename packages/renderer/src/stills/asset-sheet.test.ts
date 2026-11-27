import { describe, expect, it } from 'vitest';
import { ASSET_SHEET_COLUMNS, assetSheetGrid } from './asset-sheet.ts';

describe('assetSheetGrid', () => {
  it('fills rows of the default column count and splits the area evenly', () => {
    expect(assetSheetGrid(30, { width: 1000, height: 1200 })).toEqual({
      columns: ASSET_SHEET_COLUMNS,
      rows: 6,
      cellWidth: 200,
      cellHeight: 200,
    });
  });

  it('uses fewer columns than assets only when needed, and one row for none', () => {
    expect(assetSheetGrid(3, { width: 900, height: 300 })).toMatchObject({ columns: 3, rows: 1 });
    expect(assetSheetGrid(0, { width: 900, height: 300 })).toMatchObject({ columns: 1, rows: 1 });
  });
});
