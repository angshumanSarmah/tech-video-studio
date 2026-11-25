import { containsPhrase } from '../text/phrase.ts';
import type { AvoidName } from './record.ts';

/**
 * The originality check (P1C.11): a plan, script or board must not reuse a reference video's
 * names, examples, catchphrases or title. Names come from every ready reference's
 * `namesToAvoid` (code only: no model is shown them). A name the run's own research notes use is
 * the topic's, not a copy (a video on a company, from that company's sources, may name it).
 * `brand`, `person`, `example` and `phrase` names match as whole words (a plain plural too);
 * a `title` also matches a title worded at least `TITLE_REUSE_SIMILARITY` alike. Pure.
 */

/**
 * How much of a title's wording must be a reference title's to be its copy: the share of words
 * the two have in common (Jaccard over their own words, not stemmed). Topic similarity is the
 * wrong measure here: two titles on one topic share its words ("how a rate limiter works" and
 * "a rate limiter, explained": 0.5), a copy shares the wording ("who gets the very last seat"
 * of "who gets the last seat?": 0.83).
 */
export const TITLE_REUSE_SIMILARITY = 0.75;

/** The share of words two titles have in common (lower case, letters and digits). */
export function titleWordSimilarity(a: string, b: string): number {
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((w) => right.has(w)).length;
  return shared / (left.size + right.size - shared);
}

export const ORIGINALITY_CODES = ['reference_name_reused', 'reference_title_reused'] as const;
export type OriginalityCode = (typeof ORIGINALITY_CODES)[number];

/** One reference's names, by its slug (named in messages, never shown to a model before). */
export interface ReferenceNames {
  readonly slug: string;
  readonly names: readonly AvoidName[];
}

export interface OriginalityContext {
  readonly references: readonly ReferenceNames[];
  /** Everything the run's research notes say (any shape): a name found there is exempt. */
  readonly notesText: string;
}

export interface OriginalityText {
  readonly path: string;
  readonly text: string;
  /** The video's title: a reference title close to it is reused even without the same words. */
  readonly isTitle?: boolean;
}

export interface OriginalityProblem {
  readonly path: string;
  readonly code: OriginalityCode;
  readonly message: string;
}

/** The notes as one text for the exemption: every string they hold. */
export function notesTextOf(notes: unknown): string {
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(notes);
  return strings.join('\n');
}

export function referenceReuseProblems(
  texts: readonly OriginalityText[],
  ctx: OriginalityContext,
): OriginalityProblem[] {
  const names = ctx.references.flatMap((ref) =>
    ref.names
      .filter((name) => !containsPhrase(ctx.notesText, name.text, { plural: true }))
      .map((name) => ({ slug: ref.slug, name })),
  );
  if (names.length === 0) return [];
  const problems: OriginalityProblem[] = [];
  for (const { path, text, isTitle } of texts) {
    for (const { slug, name } of names) {
      if (containsPhrase(text, name.text, { plural: true })) {
        problems.push(reused(path, slug, name));
      } else if (
        isTitle &&
        name.kind === 'title' &&
        titleWordSimilarity(text, name.text) >= TITLE_REUSE_SIMILARITY
      ) {
        problems.push({
          path,
          code: 'reference_title_reused',
          message: `The title is close to a reference video's title ("${name.text}", reference ${slug}): title the video in your own words.`,
        });
      }
    }
  }
  return problems;
}

function reused(path: string, slug: string, name: AvoidName): OriginalityProblem {
  const what = name.kind === 'title' ? 'title' : name.kind === 'phrase' ? 'wording' : 'name';
  return {
    path,
    code: name.kind === 'title' ? 'reference_title_reused' : 'reference_name_reused',
    message: `"${name.text}" is a reference video's ${what} (reference ${slug}): use a generic description or the research notes' own words instead.`,
  };
}
