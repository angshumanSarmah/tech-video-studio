import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { SourceIngestError } from './errors.ts';
import type { ExtractedDocument } from './html.ts';

/** pdf.js log level: errors only (no font or structure warnings on stdout). */
const PDFJS_ERRORS_ONLY = 0;

/**
 * The text layer of a PDF, page by page (pages separated by a blank line), and its Info title.
 * A PDF pdf.js cannot open (corrupt, encrypted) fails as `unreadable`; one without a text layer
 * comes back empty (the caller reports it).
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
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
    const meta = await getMeta(pdf).catch(() => null);
    const title = typeof meta?.info.Title === 'string' ? meta.info.Title : null;
    return { title, text: text.join('\n\n') };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
