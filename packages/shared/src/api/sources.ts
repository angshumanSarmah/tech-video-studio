import { z } from 'zod';
import { SourceKindSchema, SourceStatusSchema } from '../domain/library.ts';
import {
  PASTED_TEXT_MAX_CHARS,
  SOURCE_TITLE_MAX,
  SourceFailureCodeSchema,
} from '../domain/sources.ts';
import { listOf } from './common.ts';

/**
 * `POST /api/topics/:id/sources` with a JSON body: a URL to fetch, or text pasted with a title
 * (your own notes or data; stored and chunked like an uploaded `.txt`). Files go up as
 * `multipart/form-data` (field `file`) to the same route. Sources are read by the next run's
 * ingest job.
 */
export const AddSourceRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('url'),
    url: z.url({ protocol: /^https?$/, error: 'Only http and https URLs are fetched.' }),
  }),
  z.strictObject({
    kind: z.literal('text'),
    title: z.string().trim().min(1).max(SOURCE_TITLE_MAX),
    text: z.string().trim().min(1).max(PASTED_TEXT_MAX_CHARS),
  }),
]);
export type AddSourceRequest = z.infer<typeof AddSourceRequestSchema>;

export const SourceDtoSchema = z.object({
  id: z.number().int(),
  topicId: z.number().int(),
  kind: SourceKindSchema,
  /** URL sources only. */
  url: z.string().nullable(),
  /** Uploads: the file's name; pasted text: null. */
  fileName: z.string().nullable(),
  /** The document's title once extracted; a pasted text's title from the start. */
  title: z.string().nullable(),
  status: SourceStatusSchema,
  /** Why the latest extraction failed and what to do instead. */
  error: z.string().nullable(),
  errorCode: SourceFailureCodeSchema.nullable(),
  extractedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type SourceDto = z.infer<typeof SourceDtoSchema>;

export const SourceListResponseSchema = listOf(SourceDtoSchema);
export type SourceListResponse = z.infer<typeof SourceListResponseSchema>;
