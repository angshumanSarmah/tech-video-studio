import type { EventAction } from '@explainer-studio/shared';
import type { ElementEvent } from '../primitives/element-state.ts';
import { eventParts } from '../primitives/parts.ts';
import type { AnchoredEvent } from './resolve.ts';
import { ACTION_DURATION_SEC, ACTION_EASING } from './presets.ts';

/**
 * The focus track: what is in focus over a `continuesPrevious` chain, and how strongly each
 * element is dimmed for it. Focus ids show at full opacity and everything else dims through the
 * same `dimmed` path as an explicit `dim` (`DIM_FADE`), animated on every change:
 * - a beat's `focus` applies from its start (the chain's first beat starts settled);
 * - a `focus` event replaces the set from its word (an empty set focuses everything);
 * - while an overlay is present (`statement_card`, `inset_panel`), focus moves to it and its
 *   children: the whole board dims as the overlay enters and returns as it leaves.
 * An id focuses its element, every element of a pattern instance (`<id>/…`), and the elements
 * pinned to or contained in a focused one. Overlays and their children are never focus-dimmed.
 * Pure.
 */

/** One change of the focus set: from `sec`, `ids` are in focus (empty: everything). */
export type FocusChange = { sec: number; ids: readonly string[]; animate: boolean };

/** A change of one element's focus dim: from `sec`, it moves to `dim` over `durationSec`. */
export type FocusKey = { sec: number; dim: 0 | 1; durationSec: number; action: EventAction };

/** A chain's scenes with where each beat starts (global seconds), oldest first. */
export type ChainBeat = { focus: readonly string[]; startSec: number };

/** The chain's focus sets in time order: each beat's `focus`, then its `focus` events. */
export function focusChanges(
  beats: readonly ChainBeat[],
  events: readonly AnchoredEvent[],
): FocusChange[] {
  const fromBeats = beats.map((b, i) => ({ sec: b.startSec, ids: b.focus, animate: i > 0 }));
  const fromEvents = events
    .filter((e) => e.action === 'focus')
    .map((e) => ({ sec: e.sec, ids: e.targets, animate: true }));
  // Stable: at the same second, a focus event overrides its beat's own focus.
  return [...fromBeats, ...fromEvents].sort((a, b) => a.sec - b.sec);
}

/** Seconds where the focus changes: `focus` events and overlays entering or leaving. */
export function focusChangeSecs(
  events: readonly AnchoredEvent[],
  isOverlayTarget: (target: string) => boolean,
): number[] {
  return events
    .filter(
      (e) =>
        e.action === 'focus' ||
        ((e.action === 'enter' || e.action === 'exit') &&
          !eventParts(e.params) &&
          e.targets.some(isOverlayTarget)),
    )
    .map((e) => e.sec);
}

/** An overlay appearing (`on`) or leaving, and how long that takes. */
export type OverlayToggle = { sec: number; on: boolean; durationSec: number; action: EventAction };

/**
 * When an overlay is present, from its resolved whole-element events: from `sinceSec` (the start
 * of the beat that adds it) unless its first enter/exit is an enter, then by each enter/exit.
 */
export function overlayToggles(events: readonly ElementEvent[], sinceSec: number): OverlayToggle[] {
  const presence = events.filter(
    (e) => (e.action === 'enter' || e.action === 'exit') && !eventParts(e.params),
  );
  const initial: OverlayToggle[] =
    presence[0]?.action === 'enter'
      ? []
      : [{ sec: sinceSec, on: true, durationSec: 0, action: 'enter' }];
  return [
    ...initial,
    ...presence.map((e) => ({
      sec: e.sec,
      on: e.action === 'enter',
      durationSec: ACTION_DURATION_SEC[e.action],
      action: e.action,
    })),
  ];
}

export type FocusTrackInput = {
  changes: readonly FocusChange[];
  overlays: readonly OverlayToggle[];
  /** The element a key is pinned to or contained in, if any. */
  hostOf: (key: string) => string | undefined;
};

type Moment =
  | { sec: number; kind: 'set'; change: FocusChange }
  | { sec: number; kind: 'overlay'; toggle: OverlayToggle };

/** One element's focus keys: a key wherever its dim changes (the first one settled). */
export function focusKeys(key: string, input: FocusTrackInput): FocusKey[] {
  const moments: Moment[] = [
    ...input.changes.map((change): Moment => ({ sec: change.sec, kind: 'set', change })),
    ...input.overlays.map((toggle): Moment => ({ sec: toggle.sec, kind: 'overlay', toggle })),
  ].sort((a, b) => a.sec - b.sec);
  let ids: readonly string[] = [];
  let overlays = 0;
  const keys: FocusKey[] = [];
  for (const moment of moments) {
    if (moment.kind === 'set') ids = moment.change.ids;
    else overlays += moment.toggle.on ? 1 : -1;
    const dim = overlays > 0 || !inFocus(key, ids, input.hostOf) ? 1 : 0;
    if (keys.at(-1)?.dim === dim) continue;
    keys.push({ sec: moment.sec, dim, ...motion(moment, keys.length === 0) });
  }
  return keys;
}

function motion(moment: Moment, first: boolean): Pick<FocusKey, 'durationSec' | 'action'> {
  if (moment.kind === 'overlay') {
    return { durationSec: first ? 0 : moment.toggle.durationSec, action: moment.toggle.action };
  }
  const animate = moment.change.animate && !first;
  return { durationSec: animate ? ACTION_DURATION_SEC.focus : 0, action: 'focus' };
}

/** Whether `key` is in focus under `ids` (directly, through its instance, or through its host). */
export function inFocus(
  key: string,
  ids: readonly string[],
  hostOf: (key: string) => string | undefined,
): boolean {
  if (ids.length === 0) return true;
  const seen = new Set<string>();
  for (let k: string | undefined = key; k !== undefined && !seen.has(k); k = hostOf(k)) {
    seen.add(k);
    const current = k;
    if (ids.some((id) => current === id || current.startsWith(`${id}/`))) return true;
  }
  return false;
}

/** Focus dim (0..1) at global `sec`: each key eases from wherever the previous one had got to. */
export function focusLevel(keys: readonly FocusKey[], sec: number): number {
  let from = 0;
  let active: FocusKey | undefined;
  for (const key of keys) {
    if (key.sec > sec) break;
    from = active ? keyValue(active, from, key.sec) : key.dim;
    active = key;
  }
  return active ? keyValue(active, from, sec) : 0;
}

function keyValue(key: FocusKey, from: number, sec: number): number {
  const t = key.durationSec > 0 ? (sec - key.sec) / key.durationSec : 1;
  return from + (key.dim - from) * ACTION_EASING[key.action](t);
}
