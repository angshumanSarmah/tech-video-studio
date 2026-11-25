import { z } from 'zod';
import { queryTerms } from '../text/terms.ts';

/**
 * Topic history (P1C.10): how close a new topic's title is to an earlier one, so a run that
 * repeats a past video is warned about when it starts and at the beat sheet. Titles only: an
 * angle must not hide a repeated title (the warning shows both angles). Pure.
 */

/** A score at or above this is a similar topic (a warning, never a block). */
export const TOPIC_SIMILARITY_WARN = 0.6;

/** Similar topics a warning lists, closest first. */
export const MAX_SIMILAR_TOPICS = 3;

/** Word endings folded so "limiter", "limiting" and "limit" meet. Longest first. */
const SUFFIXES = ['ization', 'izing', 'izer', 'ation', 'ing', 'ers', 'er', 'ed', 'es', 'e'];

/** A word with one common ending removed (kept when that would leave under 3 letters). */
function stem(word: string): string {
  const suffix = SUFFIXES.find((s) => word.endsWith(s) && word.length - s.length >= 3);
  return suffix ? word.slice(0, -suffix.length) : word;
}

/** A title's content words, stemmed. */
export function topicTerms(title: string): string[] {
  return [...new Set(queryTerms(title).map(stem))];
}

function trigrams(text: string): Set<string> {
  const padded = ` ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * 0..1: the highest of word overlap (Jaccard), containment (every word of the shorter title,
 * when it has at least two, is in the longer) and character-trigram overlap (Dice) of the
 * stemmed words, so "rate limiter" meets "rate limiting" and "consistent hashing" meets
 * "consistent hashing in key-value stores".
 */
export function topicSimilarity(a: string, b: string): number {
  const left = topicTerms(a);
  const right = topicTerms(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const shared = left.filter((w) => rightSet.has(w)).length;
  const jaccard = shared / (left.length + right.length - shared);
  const shorter = Math.min(left.length, right.length);
  const containment = shorter >= 2 ? shared / shorter : 0;
  const chars = dice(trigrams(left.join(' ')), trigrams(right.join(' ')));
  return Math.max(jaccard, containment, chars);
}

/** An earlier topic close to a new one: shown when a run starts and at the beat sheet. */
export const TopicMatchSchema = z.strictObject({
  topicId: z.number().int().positive(),
  title: z.string(),
  /** The earlier topic's angle (`topics.notes`). */
  angle: z.string().nullable(),
  /** Its newest run: the one that exported, else the one in progress. */
  runId: z.number().int().positive(),
  /** When that run exported (ISO); null while it is still in progress. */
  exportedAt: z.iso.datetime().nullable(),
  /** `topicSimilarity`, rounded to two decimals. */
  score: z.number().min(0).max(1),
});
export type TopicMatch = z.infer<typeof TopicMatchSchema>;

/** One line for a warning: what the new topic is close to. */
export function topicMatchMessage(match: TopicMatch): string {
  const when = match.exportedAt ? `exported ${match.exportedAt.slice(0, 10)}` : 'still in progress';
  const angle = match.angle ? `, angle "${match.angle}"` : '';
  return (
    `Close to an earlier topic: "${match.title}" (run ${match.runId}, ${when}${angle}; ` +
    `similarity ${match.score.toFixed(2)}).`
  );
}
