/**
 * Whole-word phrase matching for the agent checks: case-insensitive, words separated by spaces
 * or hyphens, never inside a longer word ("ai" is not in "explain", "token" not in
 * "tokenizer"). Pure.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PhraseOptions {
  /** Also match a plain plural: the phrase with an "s" on its last word ("tokens"). */
  readonly plural?: boolean;
}

/** Whether `text` contains `phrase` as whole words. An empty phrase never matches. */
export function containsPhrase(text: string, phrase: string, options: PhraseOptions = {}): boolean {
  const words = phrase
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const body = words.map(escapeRegExp).join('[\\s-]+') + (options.plural ? 's?' : '');
  return new RegExp(`(?<![\\p{L}\\d])${body}(?![\\p{L}\\d])`, 'iu').test(text);
}
