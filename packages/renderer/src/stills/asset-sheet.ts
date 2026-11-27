/**
 * Layout of the asset contact sheet (`AssetSheet`, P1C.12): a grid of equal cells under a title
 * row, as many columns as keep cells at least `MIN_CELL` wide. Pure.
 */

export const ASSET_SHEET_COLUMNS = 5;
/** Glyph sizes drawn in each cell: the library's large and small use. */
export const ASSET_SHEET_SIZES = [112, 32] as const;

export type AssetSheetGrid = {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
};

export function assetSheetGrid(
  count: number,
  area: { width: number; height: number },
  columns: number = ASSET_SHEET_COLUMNS,
): AssetSheetGrid {
  const cols = Math.max(1, Math.min(columns, count));
  const rows = Math.max(1, Math.ceil(count / cols));
  return {
    columns: cols,
    rows,
    cellWidth: Math.floor(area.width / cols),
    cellHeight: Math.floor(area.height / rows),
  };
}
