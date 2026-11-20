import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { SourceIngestError } from './errors.ts';
import type { ExtractedDocument } from './html.ts';
import { largestTextTitle, type SizedText } from './pdf-title.ts';

/** pdf.js log level: errors only (no font or structure warnings on stdout). */
const PDFJS_ERRORS_ONLY = 0;
/** Text matrix shear/rotation terms below this count as upright text. */
const ROTATION_EPSILON = 1e-3;

/**
 * The text layer of a PDF, page by page (pages separated by a blank line), and its title: the
 * Info title, else the largest upright text on page 1 (`largestTextTitle`), else null (the caller falls
 * back to the file name). A PDF pdf.js cannot open (corrupt, encrypted) fails as `unreadable`; one without a text layer
 * comes back empty (the caller reports it).
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  let pdf: PdfDocument;
  try {
    // pdf.js may transfer the buffer it is given: pass a copy.
    pdf = await getDocumentProxy(bytes.slice(), { verbosity: PDFJS_ERRORS_ONLY });
  } catch (error) {
    throw new SourceIngestError(
      'unreadable',
      `The PDF could not be read (${(error as Error).message}). Upload another copy, or its text as .txt.`,
      { cause: error },
    );
  }
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const title = (await infoTitle(pdf)) ?? (await firstPageTitle(pdf));
    return { title, text: text.join('\n\n') };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

async function infoTitle(pdf: PdfDocument): Promise<string | null> {
  const meta = await getMeta(pdf).catch(() => null);
  const title = meta?.info.Title;
  return typeof title === 'string' && title.trim() !== '' ? title : null;
}

async function firstPageTitle(pdf: PdfDocument): Promise<string | null> {
  if (pdf.numPages < 1) return null;
  const content = await (await pdf.getPage(1)).getTextContent();
  const items: SizedText[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const [a = 0, b = 0, c = 0, d = 0] = item.transform as number[];
    // Titles are horizontal: rotated text (e.g. a repository's ID stamp up the margin) is skipped.
    if (Math.abs(b) > ROTATION_EPSILON || Math.abs(c) > ROTATION_EPSILON || a <= 0) continue;
    // The font size is the text matrix's vertical scale.
    items.push({ str: item.str, fontSize: Math.abs(d), hasEOL: item.hasEOL });
  }
  return largestTextTitle(items);
}
