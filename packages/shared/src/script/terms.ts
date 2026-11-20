import { foldTerm } from '../director/checks.ts';

/**
 * Matching glossary terms in narration and titles, and finding the topic's main term. A term
 * matches whole words in any case, each word singular or inflected ("token buckets", "fails
 * closed", "rate limiter" for "Rate limiters"), with spaces or hyphens between them.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** An inflection a term's word may carry ("buckets", "fails closed", "limiters"). */
const INFLECTION = '(?:s|es|ed|ing)?';

/** A plural term word made singular, so the singular matches too ("limiters" → "limiter"). */
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)
    ? word.slice(0, -1)
    : word;
}

/** Whether a text names a term (case-insensitive, whole words, each word inflected or not). */
export function mentionsTerm(text: string, term: string): boolean {
  const words = foldTerm(term)
    .split(' ')
    .map((w) => escapeRegExp(singular(w)) + INFLECTION)
    .join('[\\s-]+');
  return new RegExp(`(?<![\\p{L}\\d])${words}(?![\\p{L}\\d])`, 'iu').test(text);
}

const wordCount = (term: string) => foldTerm(term).split(' ').length;

/**
 * The topic's main term: the longest of the topic title and the glossary terms that the video
 * title names (the topic title wins a tie, then glossary order), else the topic title. Pure.
 */
export function mainTerm(title: string, topicTitle: string, glossary: readonly string[]): string {
  const named = [topicTitle, ...glossary].filter((term) => mentionsTerm(title, term));
  return (
    named.reduce<string | undefined>(
      (best, term) => (best === undefined || wordCount(term) > wordCount(best) ? term : best),
      undefined,
    ) ?? topicTitle
  );
}
