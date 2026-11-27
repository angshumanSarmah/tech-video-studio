import {
  anchorWordIndex,
  foldTerm,
  headlineAnchor,
  type Headline,
  mentionsTerm,
  termForms,
  narrationWords,
  normalizeWord,
  toJsonPath,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import {
  describeBoard,
  type BoardDescription,
  type BoardItemDescription,
} from './board-description.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Show it, then name it (P1C.8): a term the plan introduces in a beat (`newTerms`) should be on
 * the board by the time the narration says it. `term_shown_late` flags a term spoken before the
 * board element whose text names it enters (Generator: bring the element in on that word), or
 * spoken with nothing on the board naming it (Scriptwriter: give the beat a tag with the term).
 * An element that enters on the term's own words is in time; one left on the board by an earlier
 * beat, or there from the beat's start, is already shown; a pinned element without its own enter
 * comes in with its host. A concept headline that names the term before its "=" ("X = plain
 * meaning") shows it too, from its anchor (by default just after the beat starts). Blocking at
 * beginner, advisory otherwise (`curatorCodeChecks`). Pure.
 */

export const TERM_SHOWN_LATE = 'term_shown_late';

type Mention = { first: number; last: number };

export function termShownLateWarnings(
  spec: RenderableVideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  return spec.story.beats.flatMap((beat) => {
    const i = spec.scenes.findIndex((s) => s.beatId === beat.id);
    const k = spec.script.findIndex((s) => s.beatId === beat.id);
    const narration = spec.script[k]?.narration;
    if (i < 0 || narration === undefined || beat.newTerms.length === 0) return [];
    const board = describeBoard(spec, beat.id, { registries });
    const written = narration.split(/\s+/).filter((t) => normalizeWord(t).length > 0);
    return beat.newTerms.flatMap((term) => {
      const mention = firstMention(narrationWords(narration), term);
      if (!mention) return [];
      const said = `word ${mention.first} ("${written[mention.first] ?? ''}")`;
      const headline = headlineShowsAt(spec.script[k]?.headline, term, narration);
      if (headline !== undefined && headline <= mention.last) return [];
      const showing = board.items.filter((item) => namesTerm(item, term));
      if (showing.length === 0) return [unshown(k, term, said)];
      const at = (item: BoardItemDescription) => shownAt(item, board);
      const first = showing.reduce((a, b) => (at(b) < at(a) ? b : a));
      if (at(first) <= mention.last) return [];
      return [late(spec, i, first, term, said, at(first), written)];
    });
  });
}

/**
 * The first narration words that say the term in any of its forms (`termForms`: "multiplexing /
 * event loop", "round trip (RTT)"), each word inflected or not.
 */
function firstMention(words: readonly string[], term: string): Mention | undefined {
  for (let i = 0; i < words.length; i++) {
    for (const form of termForms(term)) {
      const n = foldTerm(form).split(' ').length;
      if (i + n > words.length) continue;
      if (mentionsTerm(words.slice(i, i + n).join(' '), form)) return { first: i, last: i + n - 1 };
    }
  }
  return undefined;
}

/**
 * The word a concept headline "X = plain meaning" naming the term appears on (-1: from the
 * beat's start, the default anchor); undefined when the headline does not define the term.
 */
function headlineShowsAt(
  headline: Headline | undefined,
  term: string,
  narration: string,
): number | undefined {
  if (headline?.semantic !== 'concept' || !headline.text.includes('=')) return undefined;
  const defined = headline.text.slice(0, headline.text.indexOf('='));
  if (!mentionsTerm(defined, term)) return undefined;
  const anchor = headlineAnchor(headline);
  if (anchor.type === 'beat') return anchor.edge === 'start' ? -1 : Number.POSITIVE_INFINITY;
  return anchorWordIndex(anchor, narrationWords(narration)) ?? Number.POSITIVE_INFINITY;
}

function namesTerm(item: BoardItemDescription, term: string): boolean {
  return (
    item.texts.some((t) => mentionsTerm(t.value, term)) ||
    item.inner.some((inner) => inner.texts.some((t) => mentionsTerm(t, term)))
  );
}

/** The word an item appears on: -1 when it is there from the beat's start. */
function shownAt(
  item: BoardItemDescription,
  board: BoardDescription,
  seen = new Set<string>(),
): number {
  if (!item.added || seen.has(item.id)) return -1;
  const enters = [
    ...item.events.filter((e) => e.action === 'enter' && !e.target).map((e) => e.at),
    ...item.anchors.map((a) => a.at),
  ].flatMap((at) => (at.kind === 'word' ? [at.index] : []));
  if (enters.length > 0) return Math.min(...enters);
  const pin = item.refs.find((r) => r.side !== undefined);
  const host = pin ? board.items.find((h) => h.id === pin.id) : undefined;
  return host ? shownAt(host, board, new Set([...seen, item.id])) : -1;
}

function unshown(k: number, term: string, said: string): SpecError {
  return {
    path: toJsonPath(['script', k, 'tags']),
    code: TERM_SHOWN_LATE,
    message:
      `"${term}" is introduced here (${said}), but nothing on the board names it and the ` +
      'headline does not define it. Give the beat a tag with the term, or a concept headline ' +
      `"${term} = plain meaning", so the screen shows what the narration names.`,
  };
}

function late(
  spec: RenderableVideoSpec,
  i: number,
  item: BoardItemDescription,
  term: string,
  said: string,
  enters: number,
  written: readonly string[],
): SpecError {
  const scene = spec.scenes[i];
  const j =
    item.kind === 'pattern'
      ? scene?.patterns.findIndex((p) => p.id === item.id)
      : scene?.elements.findIndex((e) => e.id === item.id);
  const where = item.kind === 'pattern' ? 'patterns' : 'elements';
  return {
    path: toJsonPath(['scenes', i, where, j ?? 0]),
    code: TERM_SHOWN_LATE,
    message:
      `"${term}" is spoken on ${said}, but "${item.id}", which shows it, enters only on word ` +
      `${enters} ("${written[enters] ?? ''}"). Bring it in on the word that names the term, so ` +
      'the viewer sees what the word means as they hear it.',
  };
}
