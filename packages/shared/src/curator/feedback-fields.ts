import type { FixField } from './review.ts';

/**
 * Which part of a beat a reviewer's note is about (pure; the CLI's default for a beat
 * regenerate). A note about what is drawn (cards, icons, pins, focus, layout) goes to the
 * Generator alone, so the Scriptwriter never rewrites narration that was fine; a note about what
 * is said goes to the Scriptwriter (its board is remapped, or redrawn when anchors are lost).
 * When both kinds of cue appear, or neither, it is both. Quoted text is a label or a phrase, not
 * a cue, so "Pin 'say less' to the card" stays a board note.
 */

export type FeedbackAbout = 'narration' | 'board' | 'both';

const BOARD_CUES = [
  'board',
  'card',
  'cards',
  'icon',
  'icons',
  'pin',
  'pinned',
  'focus',
  'dim',
  'dimmed',
  'greyed',
  'grayed',
  'draw',
  'drawn',
  'visible',
  'visibly',
  'bigger',
  'larger',
  'smaller',
  'tiny',
  'layout',
  'highlight',
  'highlighted',
  'arrow',
  'arrows',
  'bar',
  'timer',
  'colour',
  'color',
  'position',
  'element',
  'elements',
  'animation',
  'animate',
  'screen',
  'queue',
  'diagram',
];

const NARRATION_CUES = [
  'say',
  'says',
  'saying',
  'said',
  'mention',
  'wording',
  'word',
  'words',
  'sentence',
  'narration',
  'narrate',
  'claim',
  'claims',
  'phrase',
  'phrasing',
  'call',
  'calls',
  'explain',
  'voice',
  'spoken',
  'speak',
  'tell',
];

/** Quoted spans ('…', "…", ‘…’, “…”) removed, then lower-case words. */
function cueWords(note: string): Set<string> {
  const unquoted = note.replace(/["“][^"“”]*["”]|(^|[^\w])['‘][^'‘’]*['’](?!\w)/g, ' ');
  return new Set(unquoted.toLowerCase().match(/[a-z]+/g) ?? []);
}

export function feedbackAbout(note: string): FeedbackAbout {
  const words = cueWords(note);
  const board = BOARD_CUES.some((w) => words.has(w));
  const narration = NARRATION_CUES.some((w) => words.has(w));
  if (board === narration) return 'both';
  return board ? 'board' : 'narration';
}

/** The fields a beat regenerate changes by default for that note. */
export function fieldsForFeedback(note: string): FixField[] {
  const about = feedbackAbout(note);
  return about === 'both' ? ['narration', 'board'] : [about];
}
