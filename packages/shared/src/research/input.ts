import { z } from 'zod';
import { SourceChunkIdSchema } from './notes.ts';

/**
 * What one research step read (`runs/<id>/research/input-<step>.json`): the chunks the
 * Researcher was given and the ones the source token budget left out. Gate 1 shows both, and
 * `researchNotesProblems` checks citations against `sources[].chunks`.
 */

export const ResearchChunkSchema = z.strictObject({
  id: SourceChunkIdSchema,
  text: z.string().min(1),
});

export const ResearchSourceSchema = z.strictObject({
  sourceId: z.number().int().positive(),
  title: z.string().nullable(),
  /** The URL, or the uploaded file's name. */
  origin: z.string().min(1),
  /** When the text was fetched or read (the source's "as of" date), ISO 8601. */
  fetchedAt: z.iso.datetime().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The chunks sent to the model, in source order. */
  chunks: z.array(ResearchChunkSchema).min(1),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const OmittedChunkSchema = z.strictObject({
  id: SourceChunkIdSchema,
  sourceId: z.number().int().positive(),
  /** Estimated tokens (`estimateTokens`). */
  tokens: z.number().int().nonnegative(),
});
export type OmittedChunk = z.infer<typeof OmittedChunkSchema>;

export const ResearchInputSchema = z.strictObject({
  topic: z.strictObject({
    title: z.string().min(1),
    /** The run's free-text angle / notes. */
    angle: z.string().nullable(),
  }),
  series: z.strictObject({ name: z.string().min(1), label: z.string().min(1) }),
  sources: z.array(ResearchSourceSchema).min(1),
  budget: z.strictObject({
    /** `settings.research.sourceTokenBudget` at the time of the step. */
    tokens: z.number().int().positive(),
    /** Estimated tokens of every pinned chunk. */
    sourceTokens: z.number().int().nonnegative(),
    /** Estimated tokens of the chunks sent. */
    keptTokens: z.number().int().nonnegative(),
  }),
  /** Chunks the budget left out, in source order; empty when everything fit. */
  omittedChunks: z.array(OmittedChunkSchema),
});
export type ResearchInput = z.infer<typeof ResearchInputSchema>;
