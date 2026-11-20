import type { ExtractedDocument } from './html.ts';

/**
 * Markdown is kept as written, minus HTML comments: rendered markdown never shows them, so, like
 * hidden HTML, they must not reach the Researcher. The title is the first `#` heading (else the
 * first heading of any level).
 */
export function extractMarkdown(source: string): ExtractedDocument {
  const text = stripHtmlComments(source);
  return { title: firstHeading(text), text };
}

/** Plain text has no title of its own (the caller falls back to the URL or file name). */
export function extractPlainText(source: string): ExtractedDocument {
  return { title: null, text: source };
}

/** Removes `<!-- … -->`, including an unclosed one (which hides the rest of the document). */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}

function firstHeading(text: string): string | null {
  const outsideCode = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
  const h1 = /^# +(.+?)\s*#*\s*$/m.exec(outsideCode);
  const any = /^#{1,6} +(.+?)\s*#*\s*$/m.exec(outsideCode);
  return (h1 ?? any)?.[1] ?? null;
}
