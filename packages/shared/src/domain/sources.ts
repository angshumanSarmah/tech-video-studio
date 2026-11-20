import { z } from 'zod';

/**
 * Extracted source text is split into chunks the Researcher cites by id: `source-<id>#chunk-<n>`,
 * counted from 1. A chunk id names one passage of one version of a source (the chunks file sits
 * next to the text it was cut from, under the same content hash).
 */
export const SOURCE_CHUNK_ID_PATTERN = /^source-([1-9]\d*)#chunk-([1-9]\d*)$/;

export function sourceChunkId(sourceId: number, n: number): string {
  return `source-${sourceId}#chunk-${n}`;
}

export function parseSourceChunkId(id: string): { sourceId: number; n: number } | null {
  const match = SOURCE_CHUNK_ID_PATTERN.exec(id);
  if (!match) return null;
  return { sourceId: Number(match[1]), n: Number(match[2]) };
}

/** Longest title stored for a source; longer ones are cut at a word with an ellipsis. */
export const SOURCE_TITLE_MAX = 200;

export const SourceChunkSchema = z.strictObject({
  id: z.string().regex(SOURCE_CHUNK_ID_PATTERN),
  text: z.string().min(1),
  /** UTF-16 offsets of the chunk in the extracted text: `text === full.slice(start, end)`. */
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});
export type SourceChunk = z.infer<typeof SourceChunkSchema>;

/** `<hash>.chunks.json` next to `<hash>.txt`: depends only on the source id and the text. */
export const SourceChunksFileSchema = z.strictObject({
  sourceId: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  chunks: z.array(SourceChunkSchema).min(1),
});
export type SourceChunksFile = z.infer<typeof SourceChunksFileSchema>;

/**
 * Why a source could not be ingested. The message stored on the source says what to do; the code
 * lets the UI and tests tell the cases apart.
 */
export const SOURCE_FAILURE_CODES = [
  'invalid_url',
  'blocked',
  'not_found',
  'rate_limited',
  'http_error',
  'server_error',
  'timeout',
  'network',
  'too_large',
  'unsupported_type',
  'unreadable',
  'empty',
] as const;
export const SourceFailureCodeSchema = z.enum(SOURCE_FAILURE_CODES);
export type SourceFailureCode = z.infer<typeof SourceFailureCodeSchema>;
