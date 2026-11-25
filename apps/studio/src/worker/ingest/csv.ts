import type { ExtractedDocument } from './html.ts';
import { labelledRows } from './tables.ts';

/** Delimiters a `.csv` may use; the one the header line uses most wins (comma on a tie). */
const DELIMITERS = [',', ';', '\t'] as const;

/**
 * A CSV file as labelled rows (`labelledRows`): the first non-empty row is the header. Quoted
 * fields (RFC 4180: doubled quotes, delimiters and line breaks inside quotes) are read as one
 * value. The title is left to the file name.
 */
export function extractCsv(source: string): ExtractedDocument {
  const rows = parseCsv(source).filter((row) => row.some((cell) => cell.trim() !== ''));
  const [header, ...body] = rows;
  if (!header) return { title: null, text: '' };
  return { title: null, text: labelledRows(header, body) };
}

export function parseCsv(text: string): string[][] {
  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r|\n|$/)).replace(/"[^"]*"/g, '');
  let best: string = DELIMITERS[0];
  let most = 0;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > most) [best, most] = [d, count];
  }
  return best;
}
