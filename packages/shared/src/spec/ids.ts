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

/**
 * What an event may target: an element or pattern instance id (`api`), or one element inside a
 * pattern instance (`<instance>/<id>`, e.g. `lock/resource`). The renderer checks the inner id
 * against the pattern's expansion and limits which actions may use it.
 */
export const EventTargetSchema = z
  .string()
  .max(2 * SPEC_ID_MAX_LENGTH + 1)
  .regex(
    /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)?$/,
    'Use an element or pattern id, or "<pattern-instance>/<element>" for one element inside a pattern.',
  );

/** The instance id and inner element id of a `<instance>/<id>` target; undefined for a plain id. */
export function splitInnerTarget(target: string): { instance: string; inner: string } | undefined {
  const slash = target.indexOf('/');
  if (slash < 0) return undefined;
  return { instance: target.slice(0, slash), inner: target.slice(slash + 1) };
}

/** Free-form props or params; the registry for the referenced id validates them. */
export const OpenParamsSchema = z.record(z.string(), z.unknown());
