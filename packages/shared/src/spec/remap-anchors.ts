import { anchorWordIndex } from './anchors.ts';
import { findWordOccurrence, narrationWords, normalizeWord } from './narration.ts';
import type { BeatScene, EventAnchor } from './scene.ts';

/**
 * Keeping a board on its words after its narration changes (P1C.8 repairs). The old and new
 * narration words are aligned by their longest common subsequence; every word anchor of the
 * board (events, and a pattern's `params.at`) moves to its word's new index, a `word_text`
 * anchor to its word's new occurrence. When every anchored word survives the edit the board is
 * remapped; otherwise the lost anchors are listed and the board has to be drawn again. Beat-edge
 * anchors never move. Pure.
 */

export type RemappedAnchor = { path: (string | number)[]; word: string };

export type RemapResult =
  { ok: true; scene: BeatScene; moved: number } | { ok: false; lost: RemappedAnchor[] };

/** Old word index → new word index, for the words the longest common subsequence keeps. */
export function wordAlignment(
  oldWords: readonly string[],
  newWords: readonly string[],
): Map<number, number> {
  const n = oldWords.length;
  const m = newWords.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        oldWords[i] === newWords[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const map = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (oldWords[i] === newWords[j]) {
      map.set(i, j);
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return map;
}

/** How many times `words[index]` occurs up to and including `index` (1 = its first). */
function occurrenceAt(words: readonly string[], index: number): number {
  const word = words[index];
  return words.slice(0, index + 1).filter((w) => w === word).length;
}

type Context = {
  oldWords: readonly string[];
  newWords: readonly string[];
  map: ReadonlyMap<number, number>;
};

/** The anchor on the new narration, or undefined when its word did not survive. */
export function remapAnchor(anchor: EventAnchor, ctx: Context): EventAnchor | undefined {
  if (anchor.type === 'beat') return anchor;
  const index = anchorWordIndex(anchor, ctx.oldWords);
  const moved = index === undefined ? undefined : ctx.map.get(index);
  if (moved === undefined) return undefined;
  if (anchor.type === 'word') return { ...anchor, index: moved };
  const text = normalizeWord(anchor.text);
  const occurrence = occurrenceAt(ctx.newWords, moved);
  return findWordOccurrence(ctx.newWords, text, occurrence) === moved
    ? { ...anchor, occurrence }
    : { type: 'word', index: moved };
}

/** The scene with every word anchor on the new narration's words, or the anchors lost. */
export function remapAnchors(
  scene: BeatScene,
  oldNarration: string,
  newNarration: string,
): RemapResult {
  const oldWords = narrationWords(oldNarration);
  const newWords = narrationWords(newNarration);
  const ctx = { oldWords, newWords, map: wordAlignment(oldWords, newWords) };
  const lost: RemappedAnchor[] = [];
  let moved = 0;
  const shift = (anchor: EventAnchor, path: (string | number)[]): EventAnchor => {
    const next = remapAnchor(anchor, ctx);
    if (!next) {
      const index = anchorWordIndex(anchor, oldWords);
      lost.push({ path, word: index === undefined ? '?' : (oldWords[index] ?? '?') });
      return anchor;
    }
    if (JSON.stringify(next) !== JSON.stringify(anchor)) moved += 1;
    return next;
  };
  const events = scene.events.map((event, e) => ({
    ...event,
    at: shift(event.at, ['events', e, 'at']),
  }));
  const patterns = scene.patterns.map((pattern, p) => {
    const at = (pattern.params as { at?: Record<string, EventAnchor> }).at;
    if (!at) return pattern;
    const remapped = Object.fromEntries(
      Object.entries(at).map(([name, anchor]) => [
        name,
        shift(anchor, ['patterns', p, 'params', 'at', name]),
      ]),
    );
    return { ...pattern, params: { ...pattern.params, at: remapped } };
  });
  if (lost.length > 0) return { ok: false, lost };
  return { ok: true, scene: { ...scene, events, patterns }, moved };
}
