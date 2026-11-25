/**
 * Tabular data (CSV, JSON lists of records, Word tables) as text the Researcher can cite row by
 * row: the columns once, then one paragraph per row with every value under its column's name, so
 * a row read alone (a chunk can start mid-table) still says what each number is. Empty cells are
 * left out of their row; a column with no name is called by its position.
 */
export function labelledRows(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const names = header.map((name, i) => flat(name) || `Column ${i + 1}`);
  const lines = rows
    .map((row) =>
      names
        .map((name, i) => [name, flat(row[i] ?? '')] as const)
        .filter(([, value]) => value !== '')
        .map(([name, value]) => `${name}: ${value}`)
        .join('; '),
    )
    .filter((line) => line !== '')
    .map((line) => `- ${line}`);
  return [`Columns: ${names.join('; ')}`, ...lines].join('\n\n');
}

const flat = (cell: string): string => cell.replace(/\s+/g, ' ').trim();
