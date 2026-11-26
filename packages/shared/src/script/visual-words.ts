import { containsPhrase } from '../text/phrase.ts';

/**
 * Words that describe the picture rather than the idea (pure; `narration_describes_visuals`):
 * colours, shapes and on-screen actions. Narration says what happens; the board shows it, so a
 * sentence like "one slow command stretches into a long bar" promises a drawing the Generator
 * may never make (run 1's b5). Advisory: a few are ordinary words in some sentences.
 */

export const VISUAL_COLOUR_WORDS = [
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'grey',
  'gray',
] as const;

export const VISUAL_SHAPE_WORDS = [
  'bar',
  'box',
  'circle',
  'arrow',
  'square',
  'triangle',
  'rectangle',
] as const;

export const VISUAL_ACTION_PHRASES = [
  'shown',
  'on screen',
  'onscreen',
  'on the screen',
  'highlighted',
  'lights up',
  'light up',
  'glows',
  'flashes',
  'blinks',
  'fades',
  'zooms',
  'zoom in',
  'zoom out',
  'pops up',
  'you can see',
  'watch as',
] as const;

/**
 * Technical terms that contain a colour or shape word and mean neither ("a red-black tree",
 * "blue-green deployment"): removed before matching.
 */
const TERM_EXCEPTIONS = [
  'red-black',
  'blue-green',
  'red team',
  'blue team',
  'green field',
  'greenfield',
  'black box',
  'square root',
  'round robin',
] as const;

const WORDS: readonly { readonly word: string; readonly plural: boolean }[] = [
  ...VISUAL_COLOUR_WORDS.map((word) => ({ word, plural: false })),
  ...VISUAL_SHAPE_WORDS.map((word) => ({ word, plural: true })),
  ...VISUAL_ACTION_PHRASES.map((word) => ({ word, plural: false })),
];

function withoutExceptions(text: string): string {
  return TERM_EXCEPTIONS.reduce(
    (t, term) => t.replace(new RegExp(term.replace(/[\s-]+/g, '[\\s-]+'), 'giu'), ' '),
    text,
  );
}

/** The visual words a narration uses, in list order, each once. */
export function visualWords(narration: string): string[] {
  const text = withoutExceptions(narration);
  const plural = (w: string) => (w === 'box' ? 'boxes' : `${w}s`);
  return WORDS.filter(
    ({ word, plural: p }) =>
      containsPhrase(text, word) || (p && containsPhrase(text, plural(word))),
  ).map(({ word }) => word);
}
