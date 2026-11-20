import { sourceChunkId, type SourceChunk } from '@explainer-studio/shared';

/** A chunk is closed once it reaches this many characters (about 200 words)... */
export const CHUNK_TARGET_CHARS = 1_200;
/** ...and never grows past this; longer paragraphs are split at sentences. */
export const CHUNK_MAX_CHARS = 2_000;
/** A last chunk shorter than this joins the one before when it fits. */
export const CHUNK_MIN_CHARS = 200;

interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Splits normalized text into chunks of whole paragraphs (blank-line separated), about
 * `CHUNK_TARGET_CHARS` each. A heading (`#` line) never ends a chunk: it moves to the next one
 * with the text it introduces. Each chunk is an exact slice of `text` (`start`, `end`), so a
 * citation can be shown in place. Deterministic: the same text gives the same chunks.
 */
export function chunkText(sourceId: number, text: string): SourceChunk[] {
  const blocks = paragraphs(text).flatMap((span) => splitLong(text, span));
  return packBlocks(text, blocks).map((span, i) => ({
    id: sourceChunkId(sourceId, i + 1),
    text: text.slice(span.start, span.end),
    start: span.start,
    end: span.end,
  }));
}

function paragraphs(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(/[^\n]+(?:\n[^\n]+)*/g)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const start = match.index + lead;
    spans.push({ start, end: start + trimmed.length });
  }
  return spans;
}

/** Cuts a paragraph longer than the max at sentence ends, else line ends, else spaces. */
function splitLong(text: string, span: Span): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  while (span.end - start > CHUNK_MAX_CHARS) {
    const cut = cutPoint(text, start, start + CHUNK_MAX_CHARS);
    pieces.push({ start, end: trimEndAt(text, start, cut) });
    start = skipSpace(text, cut, span.end);
  }
  if (start < span.end) pieces.push({ start, end: span.end });
  return pieces;
}

/** The best end (exclusive) for a piece in `[from, limit)`; past `from + CHUNK_MIN_CHARS`. */
function cutPoint(text: string, from: number, limit: number): number {
  const window = text.slice(from, limit);
  const floor = CHUNK_MIN_CHARS;
  for (const pattern of [/[.!?]["')\]]?(?=\s)/g, /\n/g, / /g]) {
    let best = -1;
    for (const match of window.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (end >= floor) best = end;
    }
    if (best > 0) return from + best;
  }
  return limit;
}

function trimEndAt(text: string, start: number, end: number): number {
  let e = end;
  while (e > start && /\s/.test(text[e - 1]!)) e--;
  return e;
}

function skipSpace(text: string, from: number, limit: number): number {
  let s = from;
  while (s < limit && /\s/.test(text[s]!)) s++;
  return s;
}

/** A one-line `#` heading, as written by markdown sources and the HTML extractor. */
function isHeading(text: string, block: Span): boolean {
  const content = text.slice(block.start, block.end);
  return /^#{1,6} /.test(content) && !content.includes('\n');
}

function packBlocks(text: string, blocks: readonly Span[]): Span[] {
  const chunks: Span[][] = [];
  let current: Span[] = [];
  const close = () => {
    const carry: Span[] = [];
    while (current.length > 1 && isHeading(text, current.at(-1)!)) carry.unshift(current.pop()!);
    if (current.length > 0) chunks.push(current);
    current = carry;
  };
  for (const block of blocks) {
    const first = current[0];
    // Headings alone never close: they stay with their text, even a bit past the max.
    const onlyHeadings = current.every((b) => isHeading(text, b));
    const tooBig =
      first !== undefined && !onlyHeadings && block.end - first.start > CHUNK_MAX_CHARS;
    const full = first !== undefined && current.at(-1)!.end - first.start >= CHUNK_TARGET_CHARS;
    if (tooBig || full) close();
    current.push(block);
  }
  close();
  return mergeShortTail(chunks.map((c) => ({ start: c[0]!.start, end: c.at(-1)!.end })));
}

function mergeShortTail(spans: Span[]): Span[] {
  const last = spans.at(-1);
  const before = spans.at(-2);
  if (!last || !before) return spans;
  const short = last.end - last.start < CHUNK_MIN_CHARS;
  if (!short || last.end - before.start > CHUNK_MAX_CHARS) return spans;
  return [...spans.slice(0, -2), { start: before.start, end: last.end }];
}
