import { posix } from 'node:path';
import { UPLOAD_EXTENSIONS, type UploadExtension } from '@explainer-studio/shared';
import { extractCsv } from './csv.ts';
import { extractDocx } from './docx.ts';
import { SourceIngestError } from './errors.ts';
import { decodeHtml, decodeText, extractHtml, type ExtractedDocument } from './html.ts';
import { extractJson } from './json.ts';
import { extractMarkdown, extractPlainText } from './markdown.ts';
import { extractPdf } from './pdf.ts';

export const DOCUMENT_FORMATS = ['html', 'markdown', 'text', 'pdf', 'docx', 'csv', 'json'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Extensions read from uploads (`kind: 'file'`; `UPLOAD_EXTENSIONS`). Anything else is refused. */
export const UPLOAD_FORMATS: Readonly<Record<UploadExtension, DocumentFormat>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.csv': 'csv',
  '.json': 'json',
};

const BY_EXTENSION: Readonly<Record<string, DocumentFormat>> = {
  ...UPLOAD_FORMATS,
  '.html': 'html',
  '.htm': 'html',
};

const BY_MIME: Readonly<Record<string, DocumentFormat>> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/**
 * The format of a fetched body: PDF magic bytes first, then the content type, then the file
 * name's extension (`text/plain` and GitHub's raw types say nothing about markdown), then an
 * HTML sniff. Any other `text/*` is plain text; everything else is unsupported.
 */
export function detectFormat(
  bytes: Uint8Array,
  contentType: string | null,
  name: string,
): DocumentFormat {
  if (isPdf(bytes)) return 'pdf';
  const mime = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const byMime = BY_MIME[mime];
  if (byMime) return byMime;
  const byName = BY_EXTENSION[posix.extname(name).toLowerCase()];
  if (byName && byName !== 'pdf') return byName;
  if (looksLikeHtml(bytes)) return 'html';
  if (mime.startsWith('text/') || mime === '' || mime.startsWith('application/vnd.github')) {
    return 'text';
  }
  throw new SourceIngestError(
    'unsupported_type',
    `Unsupported content type ${mime}: only HTML, Markdown, plain text, PDF, Word (.docx), CSV ` +
      'and JSON are read.',
  );
}

/** The format of an upload, from its extension only. */
export function uploadFormat(fileName: string): DocumentFormat {
  const ext = posix.extname(fileName).toLowerCase();
  const format = (UPLOAD_FORMATS as Readonly<Record<string, DocumentFormat>>)[ext];
  if (format) return format;
  throw new SourceIngestError(
    'unsupported_type',
    `Unsupported file type: only ${UPLOAD_EXTENSIONS.join(', ')} uploads are read.`,
  );
}

export interface ExtractInput {
  readonly bytes: Uint8Array;
  readonly format: DocumentFormat;
  readonly contentType: string | null;
  /** The page URL (for HTML: resolves relative links); a `file:` placeholder for uploads. */
  readonly url: string;
}

export async function extractDocument(input: ExtractInput): Promise<ExtractedDocument> {
  switch (input.format) {
    case 'pdf':
      return extractPdf(input.bytes);
    case 'html':
      return extractHtml(decodeHtml(input.bytes, input.contentType), input.url);
    case 'markdown':
      return extractMarkdown(decodeText(input.bytes, input.contentType));
    case 'text':
      return extractPlainText(decodeText(input.bytes, input.contentType));
    case 'docx':
      return extractDocx(input.bytes);
    case 'csv':
      return extractCsv(decodeText(input.bytes, input.contentType));
    case 'json':
      return extractJson(decodeText(input.bytes, input.contentType));
  }
}

function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 16)).trimStart().startsWith('%PDF-');
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}
