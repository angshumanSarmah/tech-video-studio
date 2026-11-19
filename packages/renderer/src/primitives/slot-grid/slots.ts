/** Rows and columns of a `slot_grid`: explicit `cols`, else a balanced shape for the count. */
export function slotGridShape(count: number, cols?: number): { rows: number; cols: number } {
  const c = Math.max(1, Math.min(count, cols ?? defaultColumns(count)));
  return { rows: Math.ceil(count / c), cols: c };
}

function defaultColumns(count: number): number {
  if (count <= 4) return count;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 6;
}

/** Slots split into rows, in reading order. */
export function slotRows<T>(slots: readonly T[], cols: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < slots.length; i += cols) rows.push(slots.slice(i, i + cols));
  return rows;
}
