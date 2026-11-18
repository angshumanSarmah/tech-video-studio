import {
  normalizeWord,
  type BeatScene,
  type EventAction,
  type TimedWord,
} from '@explainer-studio/shared';
import type { FramedEvent } from '../timing/frames.ts';

/**
 * State for the temporary Dev* layers (see `DevBeatPreview`). Deleted with them once real
 * primitives, HUD and subtitles exist (P1A.4, P1A.5, P1B.3).
 */

export type DevTarget = { id: string; label: string };

/** Everything a beat's events can target: its elements, patterns, and inherited ids. */
export function devTargets(scene: BeatScene): DevTarget[] {
  const own = [
    ...scene.elements.map((e) => ({ id: e.id, label: e.primitive })),
    ...scene.patterns.map((p) => ({ id: p.id, label: `pattern · ${p.pattern}` })),
  ];
  const ownIds = new Set(own.map((t) => t.id));
  const inherited = [...new Set(scene.events.flatMap((e) => e.targets))]
    .filter((id) => !ownIds.has(id))
    .map((id) => ({ id, label: 'from previous beat' }));
  return [...own, ...inherited];
}

export type DevTargetState = {
  visible: boolean;
  /** Latest non-enter/exit action so far, shown on the chip. */
  lastAction: EventAction | undefined;
  /** 1 on the frame of that action, fading to 0 over `flashFrames`. */
  flash: number;
};

const SHOWS: ReadonlySet<EventAction> = new Set(['enter']);
const HIDES: ReadonlySet<EventAction> = new Set(['exit']);

/** A target is visible from its first `enter` (or from the start if it has none) until `exit`. */
export function devTargetState(
  id: string,
  events: readonly FramedEvent[],
  frame: number,
  flashFrames: number,
): DevTargetState {
  const mine = events.filter((e) => e.targets.includes(id));
  let visible = !mine.some((e) => SHOWS.has(e.action));
  let last: FramedEvent | undefined;
  for (const event of mine) {
    if (event.frame > frame) break;
    if (SHOWS.has(event.action)) visible = true;
    else if (HIDES.has(event.action)) visible = false;
    else last = event;
  }
  const age = last ? frame - last.frame : Infinity;
  return {
    visible,
    lastAction: last?.action,
    flash: age < flashFrames ? 1 - age / flashFrames : 0,
  };
}

/** Narration tokens as written, one per `narrationWords()` word ("Redis," stays "Redis,"). */
export function displayWords(narration: string): string[] {
  return narration.split(/\s+/).filter((token) => normalizeWord(token).length > 0);
}

/** Index of the word being spoken at `sec`: the last that has started, or -1 before the first. */
export function activeWordIndex(words: readonly TimedWord[], sec: number): number {
  return words.findLastIndex((w) => w.startSec <= sec);
}
