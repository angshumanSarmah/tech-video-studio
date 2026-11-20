/** Longest title taken from page text; longer runs are cut at a word with an ellipsis. */
export const PDF_TITLE_MAX_CHARS = 120;
/** Font sizes this close (pt) count as the same size (pdf.js sizes come from float matrices). */
const SIZE_TOLERANCE = 0.5;
/** A run shorter than this (a drop cap, a lone page number) is not a title. */
const MIN_TITLE_CHARS = 3;

export interface SizedText {
  readonly str: string;
  readonly fontSize: number;
  /** pdf.js marks the last item of a line. */
  readonly hasEOL: boolean;
}

/**
 * A title from a page's text when the PDF has no Info title: the first run of adjacent items in
 * the page's largest font size (whitespace-only items do not break a run), joined with a space at
 * line ends, whitespace collapsed, cut to `PDF_TITLE_MAX_CHARS`. Null when the page has no text.
 */
export function largestTextTitle(items: readonly SizedText[]): string | null {
  const visible = items.filter((item) => item.str.trim() !== '');
  if (visible.length === 0) return null;
  const largest = Math.max(...visible.map((item) => item.fontSize));
  const isLargest = (item: SizedText) => Math.abs(item.fontSize - largest) < SIZE_TOLERANCE;
  const start = items.findIndex((item) => item.str.trim() !== '' && isLargest(item));
  let text = '';
  for (const item of items.slice(start)) {
    const blank = item.str.trim() === '';
    if (!blank && !isLargest(item)) break;
    text += item.str + (item.hasEOL ? ' ' : '');
  }
  return cutTitle(text.replace(/\s+/g, ' ').trim());
}

function cutTitle(text: string): string | null {
  if (text.length < MIN_TITLE_CHARS) return null;
  if (text.length <= PDF_TITLE_MAX_CHARS) return text;
  const cut = text.slice(0, PDF_TITLE_MAX_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > PDF_TITLE_MAX_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
