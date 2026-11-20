import { z } from 'zod';

/**
 * The normalizer's fixed list of fixes (nothing else is ever changed): code fences removed,
 * prose around the JSON removed, a declared field alias renamed, a numeric string turned into
 * the number its schema expects.
 */
export const NORMALIZER_FIX_KINDS = [
  'strip_fences',
  'strip_prose',
  'alias',
  'numeric_string',
] as const;
export const NormalizerFixKindSchema = z.enum(NORMALIZER_FIX_KINDS);
export type NormalizerFixKind = z.infer<typeof NormalizerFixKindSchema>;

/** One applied fix. `path` is a JSON path (`$.script[0].headline`) for field-level fixes. */
export const NormalizerFixSchema = z.strictObject({
  kind: NormalizerFixKindSchema,
  path: z.string().optional(),
  message: z.string(),
});
export type NormalizerFix = z.infer<typeof NormalizerFixSchema>;
