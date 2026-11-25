import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { MIN_TEXT_CHARS, type SourceChunksFile } from '@explainer-studio/shared';
import {
  contentHash,
  resolveDataPath,
  sourceChunksPath,
  sourceTextPath,
} from '#core/data-files.ts';
import type { Source, SourceExtraction } from '#core/db/repositories/sources.ts';
import { chunkText } from './chunk.ts';
import { SourceIngestError } from './errors.ts';
import { detectFormat, extractDocument, uploadFormat, type DocumentFormat } from './extract.ts';
import { fetchSource, type FetchDeps } from './fetch.ts';
import { githubRawRequest, type SourceRequest } from './github.ts';
import { cleanTitle, normalizeText } from './normalize.ts';
import { writeAtomically } from '../render/target.ts';

export { MIN_TEXT_CHARS };

export interface IngestSourceDeps {
  readonly dataDir: string;
  readonly fetch?: FetchDeps;
  readonly now?: () => Date;
}

export interface IngestedSource extends SourceExtraction {
  readonly chunkCount: number;
  readonly format: DocumentFormat;
}

interface Loaded {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
  readonly format: DocumentFormat;
  readonly url: string;
  readonly fallbackTitle: string;
  /** A pasted text's own title: kept whatever the text says. */
  readonly title?: string;
}

/**
 * Fetches (URL) or reads (upload, pasted text) one source, extracts and normalizes its text, and writes the
 * text and its chunks under the text's hash (content-addressed: a rerun rewrites nothing). Throws
 * `SourceIngestError` with a reason the user can act on; rethrows the abort reason on `signal`.
 */
export async function ingestSource(
  source: Source,
  signal: AbortSignal,
  deps: IngestSourceDeps,
): Promise<IngestedSource> {
  const loaded =
    source.kind === 'url'
      ? await loadUrl(source.url ?? '', signal, deps.fetch)
      : source.kind === 'text'
        ? loadPasted(deps.dataDir, source)
        : loadUpload(deps.dataDir, source.filePath ?? '');
  const extractedAt = (deps.now ?? (() => new Date()))();
  const doc = await extractDocument(loaded);
  const text = normalizeText(doc.text);
  if (text.length < MIN_TEXT_CHARS) throw emptyFailure(loaded.format);
  const hash = contentHash(text);
  const textPath = sourceTextPath(source.topicId, source.id, hash);
  await writeOnce(deps.dataDir, textPath, text);
  const chunks = chunkText(source.id, text);
  const chunksFile: SourceChunksFile = { sourceId: source.id, contentHash: hash, chunks };
  const chunksPath = sourceChunksPath(source.topicId, source.id, hash);
  await writeOnce(deps.dataDir, chunksPath, `${JSON.stringify(chunksFile, null, 2)}\n`);
  return {
    textPath,
    contentHash: hash,
    title: cleanTitle(loaded.title) ?? cleanTitle(doc.title) ?? cleanTitle(loaded.fallbackTitle),
    extractedAt,
    chunkCount: chunks.length,
    format: loaded.format,
  };
}

async function loadUrl(raw: string, signal: AbortSignal, deps?: FetchDeps): Promise<Loaded> {
  const url = parseHttpUrl(raw);
  const request: SourceRequest = githubRawRequest(url) ?? {
    url: url.href,
    headers: {},
    name: posix.basename(url.pathname),
  };
  const body = await fetchSource(request, signal, deps);
  const format = detectFormat(body.bytes, body.contentType, request.name);
  return {
    bytes: body.bytes,
    contentType: body.contentType,
    format,
    url: body.url,
    fallbackTitle: urlFallbackTitle(url, format),
  };
}

/**
 * The title when the document has none: a PDF's file name from the URL (only a `.pdf` extension
 * is dropped, so `/pdf/1706.03762` keeps its dots), else host and path.
 */
export function urlFallbackTitle(url: URL, format: DocumentFormat): string {
  const fileName = safeDecode(posix.basename(url.pathname));
  if (format === 'pdf' && fileName !== '') return fileName.replace(/\.pdf$/i, '');
  return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function loadUpload(dataDir: string, filePath: string): Loaded {
  const name = posix.basename(filePath);
  const format = uploadFormat(name);
  const bytes = readStored(dataDir, filePath, 'uploaded file', 'Upload it again.');
  const fallbackTitle = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return { bytes, contentType: null, format, url: 'file:///upload', fallbackTitle };
}

/** Pasted text is read as plain text under the title it was given. */
function loadPasted(dataDir: string, source: Source): Loaded {
  const bytes = readStored(dataDir, source.filePath ?? '', 'pasted text', 'Paste it again.');
  const title = source.title ?? 'Pasted text';
  return {
    bytes,
    contentType: null,
    format: 'text',
    url: 'file:///pasted',
    fallbackTitle: title,
    title,
  };
}

function readStored(dataDir: string, filePath: string, what: string, retry: string): Uint8Array {
  try {
    return readFileSync(resolveDataPath(dataDir, filePath));
  } catch (error) {
    throw new SourceIngestError(
      'unreadable',
      `The ${what} could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'}). ${retry}`,
      { cause: error },
    );
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SourceIngestError('invalid_url', `Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceIngestError(
      'invalid_url',
      `Only http and https URLs are fetched, not ${url.protocol}`,
    );
  }
  return url;
}

function emptyFailure(format: DocumentFormat): SourceIngestError {
  const what =
    format === 'pdf'
      ? 'The PDF has almost no text layer (it is probably scanned). Upload its text as .txt instead.'
      : format === 'html'
        ? 'The page has almost no readable text (it is probably built by JavaScript, or behind a ' +
          'login). Paste its text as a source instead, or upload the page as a file (.pdf, .md ' +
          'or .txt).'
        : `The source has almost no text (under ${MIN_TEXT_CHARS} characters).`;
  return new SourceIngestError('empty', what);
}

/**
 * Content-addressed, so an existing file already holds exactly this content. Written atomically:
 * a crash never leaves a partial file that a rerun would then keep.
 */
async function writeOnce(dataDir: string, relPath: string, content: string): Promise<void> {
  const path = resolveDataPath(dataDir, relPath);
  if (existsSync(path)) return;
  await writeAtomically(path, (partial) => {
    writeFileSync(partial, content, 'utf8');
    return Promise.resolve();
  });
}
