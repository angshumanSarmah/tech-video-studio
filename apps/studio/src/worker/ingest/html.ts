import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import { domToText } from './dom-text.ts';
import { removeHiddenContent } from './hidden.ts';

export interface ExtractedDocument {
  readonly title: string | null;
  /** Not yet normalized (`normalizeText` runs on every format). */
  readonly text: string;
}

/**
 * Article text from an HTML page: parse without running scripts or loading anything, remove what
 * a browser would not show (`removeHiddenContent`), then Readability picks the main content and
 * `domToText` writes it out. When Readability finds no article, the whole cleaned body is used.
 */
export function extractHtml(html: string, url: string): ExtractedDocument {
  const dom = new JSDOM(html, {
    url,
    contentType: 'text/html',
    virtualConsole: new VirtualConsole(),
  });
  try {
    const { document } = dom.window;
    removeHiddenContent(document);
    const pageTitle = document.title || null;
    const article = new Readability<Node>(document, { serializer: (node) => node }).parse();
    const root = article?.content ?? document.body;
    return { title: article?.title || pageTitle, text: root ? domToText(root) : '' };
  } finally {
    dom.window.close();
  }
}

/**
 * Decodes HTML bytes: the charset in `Content-Type`, else a `<meta charset>` near the start, else
 * UTF-8. Unknown labels fall back to UTF-8.
 */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const label = charsetOf(contentType) ?? metaCharset(bytes) ?? 'utf-8';
  return decodeWith(label, bytes);
}

/** Text in the header's charset, else UTF-8 (markdown and plain text). */
export function decodeText(bytes: Uint8Array, contentType: string | null): string {
  return decodeWith(charsetOf(contentType) ?? 'utf-8', bytes);
}

function decodeWith(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function charsetOf(contentType: string | null): string | null {
  return /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? null;
}

function metaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? null;
}
