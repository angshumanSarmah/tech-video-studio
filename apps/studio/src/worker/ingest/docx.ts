import { JSDOM, VirtualConsole } from 'jsdom';
import mammoth from 'mammoth';
import { domToText } from './dom-text.ts';
import { SourceIngestError } from './errors.ts';
import type { ExtractedDocument } from './html.ts';

/**
 * A Word document (.docx): its body as HTML (mammoth: headings, lists, tables; images dropped),
 * then the same text writer as web pages, with tables as labelled rows. The title is the first
 * top-level heading, else left to the file name.
 */
export async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  const html = await toHtml(bytes);
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    virtualConsole: new VirtualConsole(),
  });
  try {
    const { body } = dom.window.document;
    const title = body.querySelector('h1')?.textContent?.trim() || null;
    return { title, text: domToText(body, { tables: 'labelled' }) };
  } finally {
    dom.window.close();
  }
}

async function toHtml(bytes: Uint8Array): Promise<string> {
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) },
    );
    return result.value;
  } catch (error) {
    throw new SourceIngestError(
      'unreadable',
      `The Word file could not be read (${(error as Error).message}). Save it again as .docx, or upload it as PDF.`,
      { cause: error },
    );
  }
}
