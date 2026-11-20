import { z } from 'zod';

/**
 * Pronunciation dictionary (`<dataDir>/config/pronunciations.json`): narration word -> what the
 * TTS should say instead. Applied before synthesis; word timings are mapped back to the original
 * words, so anchors and subtitles never see the respelling.
 *
 * Matching (worker `tts/pronunciations.ts`): a key matches one whitespace-separated narration token
 * with its edge punctuation and a possessive `'s` set aside. A key with any capital letter matches
 * only that exact case ("US" leaves "us" alone); an all-lowercase key matches any case.
 */

const KEY_PATTERN = /^[\p{L}\p{N}](?:\S*[\p{L}\p{N}])?$/u;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

export const PronunciationKeySchema = z
  .string()
  .regex(KEY_PATTERN, 'Must be one word without spaces or leading/trailing punctuation.');

export const PronunciationSaySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(HAS_WORD_CHAR, 'Must contain a letter or digit.');

export const PronunciationsSchema = z.record(PronunciationKeySchema, PronunciationSaySchema);
export type Pronunciations = z.infer<typeof PronunciationsSchema>;

/** Used when the file does not exist yet. */
export const DEFAULT_PRONUNCIATIONS: Pronunciations = {
  Redis: 'reddis',
  UPI: 'U P I',
  LRU: 'L R U',
  nginx: 'engine x',
  JSON: 'jay-son',
  OAuth: 'oh auth',
  gRPC: 'G R P C',
  PostgreSQL: 'postgres Q L',
  k8s: 'kubernetes',
  SQL: 'sequel',
};
