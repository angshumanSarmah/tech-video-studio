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

/**
 * The forms a term can be said in (pure). Plans and glossaries write alternatives: "multiplexing
 * / event loop" (a slash with spaces around it) and "round trip (RTT)" (a parenthesised alias),
 * so either side names the term. A slash inside a word ("I/O", "TCP/IP") is part of the term.
 */
export function termForms(term: string): string[] {
  const forms = term.split(/\s+\/\s+/).flatMap((part) => {
    const alias = /^(.*?)\(([^)]+)\)(.*)$/.exec(part);
    return alias ? [`${alias[1]} ${alias[3]}`, alias[2]!] : [part];
  });
  const clean = forms.map((f) => f.replace(/\s+/g, ' ').trim()).filter((f) => f.length > 0);
  return clean.length > 0 ? [...new Set(clean)] : [term];
}

/**
 * Whether a text names a term in any of its forms (`termForms`): case-insensitive, whole words,
 * each word inflected or not.
 */
export function mentionsTerm(text: string, term: string): boolean {
  return termForms(term).some((form) => mentionsForm(text, form));
}

function mentionsForm(text: string, form: string): boolean {
  const words = foldTerm(form)
    .split(' ')
    .map((w) => escapeRegExp(singular(w)) + INFLECTION)
    .join('[\\s-]+');
  return new RegExp(`(?<![\\p{L}\\d])${words}(?![\\p{L}\\d])`, 'iu').test(text);
}

const wordCount = (term: string) => foldTerm(term).split(' ').length;

/**
 * The topic's main term: the longest of the topic's subject and the glossary terms that the
 * video title (the plan's `meta.title`) names (the subject wins a tie, then glossary order), else
 * the subject. The plan has no main-term field of its own. The subject is the topic title without
 * its question and framing words (`topicSubject`: "How Redis works" → "Redis"). Pure.
 */
export function mainTerm(title: string, topicTitle: string, glossary: readonly string[]): string {
  const subject = topicSubject(topicTitle);
  const named = [subject, ...glossary].filter((term) => mentionsTerm(title, term));
  return (
    named.reduce<string | undefined>(
      (best, term) => (best === undefined || wordCount(term) > wordCount(best) ? term : best),
      undefined,
    ) ?? subject
  );
}

/** Words that open a topic as a question ("how", "what is", "why does"). */
const LEADING_FRAMING =
  /^(?:how|what|what's|why|when|where|who|which|understanding|explaining|inside)(?:\s+(?:is|are|does|do|did|can|was|were|a|an|the))*\s+/i;

/** Words that close a topic as a question or a frame ("works", "explained"). */
const TRAILING_FRAMING = /\s+(?:works?|explained|really works?|under the hood)$/i;

/**
 * What a topic title is about, without its question and framing words (pure): "How Redis works"
 * → "Redis", "What is a tokenizer?" → "tokenizer", "Rate limiters" → "Rate limiters". The title
 * as it is when nothing would be left.
 */
export function topicSubject(topicTitle: string): string {
  const subject = topicTitle
    .trim()
    .replace(/[?!.]+$/, '')
    .replace(LEADING_FRAMING, '')
    .replace(TRAILING_FRAMING, '')
    .trim();
  return subject.length > 0 ? subject : topicTitle.trim();
}
