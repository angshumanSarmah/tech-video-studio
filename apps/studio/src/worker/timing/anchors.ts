import {
  narrationWords,
  normalizeWord,
  resolveAnchorSec,
  type BeatTiming,
  type EventAnchor,
  type ResolvedEventTime,
  type VideoSpec,
} from '@explainer-studio/shared';

/** Levenshtein distance (small strings: narration words). */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/** The narration word closest to `word` (first on ties), or undefined without words. */
export function closestWord(word: string, words: readonly string[]): string | undefined {
  const target = normalizeWord(word);
  let best: { word: string; distance: number } | undefined;
  for (const candidate of words) {
    const distance = editDistance(target, candidate);
    if (!best || distance < best.distance) best = { word: candidate, distance };
  }
  return best?.word;
}

function anchorProblem(anchor: EventAnchor, words: readonly string[]): string {
  if (anchor.type === 'word') {
    return `word ${anchor.index} is past the narration's ${words.length} words`;
  }
  if (anchor.type !== 'word_text') return 'it matches no word';
  const suggestion = closestWord(anchor.text, words);
  const hint = suggestion ? ` (closest word: "${suggestion}")` : '';
  return `"${anchor.text}" (occurrence ${anchor.occurrence}) is not in the narration${hint}`;
}

export interface ResolvedEvents {
  readonly events: ResolvedEventTime[];
  /** One line per anchor that matched no word, with the closest word as a suggestion. */
  readonly problems: string[];
}

/**
 * Every scene event's anchor resolved to seconds on the track (`timing.events`, a cache the
 * renderer never reads), plus the anchors that match no word. Pure.
 */
export function resolveEventTimes(spec: VideoSpec, beats: readonly BeatTiming[]): ResolvedEvents {
  const events: ResolvedEventTime[] = [];
  const problems: string[] = [];
  for (const scene of spec.scenes ?? []) {
    const beat = beats.find((b) => b.beatId === scene.beatId);
    const narration = spec.script?.find((s) => s.beatId === scene.beatId)?.narration;
    if (!beat || narration === undefined) continue;
    const words = narrationWords(narration);
    scene.events.forEach((event, eventIndex) => {
      const atSec = resolveAnchorSec(event.at, beat, words);
      if (atSec !== undefined) events.push({ beatId: scene.beatId, eventIndex, atSec });
      else
        problems.push(
          `beat "${scene.beatId}" event ${eventIndex}: ${anchorProblem(event.at, words)}`,
        );
    });
  }
  return { events, problems };
}
