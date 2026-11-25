import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';
import { AvoidNameSchema, MAX_NAMES_TO_AVOID } from './record.ts';

/**
 * `seed/references/names-to-avoid.json` (P1C.11): per seed reference (its slug), the original's
 * names that only the person knows (brands, the creator, the incident's organisation, titles,
 * catchphrases). Kept out of the breakdown files, which stay structure-only; only code reads it.
 */
export const NamesToAvoidFileSchema = z.record(
  SpecIdSchema,
  z.array(AvoidNameSchema).max(MAX_NAMES_TO_AVOID),
);
export type NamesToAvoidFile = z.infer<typeof NamesToAvoidFileSchema>;
