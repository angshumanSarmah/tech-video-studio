import { z } from 'zod';

/** Max length of any id in a spec. */
export const SPEC_ID_MAX_LENGTH = 64;

/**
 * Ids in a VideoSpec: lowercase slugs (`beat-1`, `node_card`, `fact-3`). Used for spec-local ids
 * (chapters, beats, elements) and for ids that point into registries or catalogues (primitives,
 * patterns, layout modes, devices), which are checked against those registries later.
 */
export const SpecIdSchema = z
  .string()
  .max(SPEC_ID_MAX_LENGTH)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use a lowercase slug: letters, digits, "_" or "-".');
export type SpecId = z.infer<typeof SpecIdSchema>;

/** Free-form props or params; the registry for the referenced id validates them. */
export const OpenParamsSchema = z.record(z.string(), z.unknown());
