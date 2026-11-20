import type { EventAction } from '@explainer-studio/shared';
import type { ElementEvent } from '../primitives/element-state.ts';
import { eventParts } from '../primitives/parts.ts';
import { secToFrame } from '../timing/frames.ts';
import { eventHolds, eventStagger, type StaggerMode } from './params.ts';
import {
  ACTION_DURATION_SEC,
  HIGHLIGHT_LEAD_SEC,
  SCAN_MAX_SEC,
  SCAN_STEP_SEC,
  STAGGER_MAX_SEC,
  STAGGER_STEP_SEC,
  STAGGERED_ACTIONS,
} from './presets.ts';

/**
 * The event engine's timing step: scene and pattern events, already resolved from their anchors
 * to global seconds, become per-element events. It applies, in seconds (so every fps agrees):
 * - group stagger: an event on several targets, a pattern instance or several parts starts them
 *   a little apart (`STAGGERED_ACTIONS`), or as a deliberate sweep with `params.stagger: 'scan'`
 *   (any action; parts in the element's own order, so two scans on one element share a sweep);
 * - highlight lead: a highlight starts `HIGHLIGHT_LEAD_SEC` before its word, never before its beat;
 * - highlight clear: without `params.hold`, a highlight fades out so it is gone when its scene
 *   leaves the screen (`sceneEndSec`: the next beat's start or the video's end, so a gap or
 *   landing hold after the narration keeps it) or at the next focus change, whichever comes first
 *   (`ElementEvent.untilSec`).
 * `focus` events are not delivered to elements: the focus track handles them (`focus.ts`).
 * Pure.
 */

/** A scene or pattern event at its anchor time, before it is split per element. */
export type AnchoredEvent = {
  action: EventAction;
  /** World keys, pattern instance ids or `<instance>/<id>`. */
  targets: readonly string[];
  params?: Record<string, unknown>;
  /** Global seconds the anchor resolves to. */
  sec: number;
  /** The beat the event is anchored in (global seconds). */
  beatStartSec: number;
  beatEndSec: number;
  /** When the beat's scene leaves the screen (`sceneEndSec`): next beat start or video end. */
  sceneEndSec: number;
};

export type ResolveContext = {
  fps: number;
  /** World keys a target acts on, in order (a pattern instance: its elements). */
  keysFor: (target: string) => readonly string[];
  /** An element's part ids in its own order (empty without parts). */
  partOrder: (key: string) => readonly string[];
  /** Global seconds where the focus changes (focus events, overlays entering or leaving). */
  focusChanges: readonly number[];
};

/** Events closer than this (seconds) count as simultaneous. */
const SIMULTANEOUS_SEC = 1e-6;

/** Per-element events keyed by world key, each list in time order. */
export function resolveElementEvents(
  events: readonly AnchoredEvent[],
  ctx: ResolveContext,
): Map<string, ElementEvent[]> {
  const byKey = new Map<string, ElementEvent[]>();
  for (const event of events) {
    if (event.action === 'focus') continue;
    for (const [key, resolved] of splitEvent(event, events, ctx)) {
      byKey.set(key, [...(byKey.get(key) ?? []), resolved]);
    }
  }
  for (const list of byKey.values()) list.sort((a, b) => a.sec - b.sec);
  return byKey;
}

type Item = { key: string; part?: string; position: number };

function splitEvent(
  event: AnchoredEvent,
  all: readonly AnchoredEvent[],
  ctx: ResolveContext,
): [string, ElementEvent][] {
  const keys = [...new Set(event.targets.flatMap((t) => ctx.keysFor(t)))];
  const mode = eventStagger(event.params);
  const { items, count } = itemsOf(event, keys, mode, ctx);
  const staggers = mode === 'scan' || STAGGERED_ACTIONS.has(event.action);
  const step = !staggers
    ? 0
    : mode === 'scan'
      ? scanStep(event, all, count)
      : staggerStep(count, mode, 0);
  const start = startSec(event);
  return items.map((item) => {
    const sec = start + item.position * step;
    const params = item.part ? { ...event.params, parts: [item.part] } : event.params;
    const untilSec = clearSec(event, sec, ctx.focusChanges);
    return [
      item.key,
      {
        action: event.action,
        frame: secToFrame(sec, ctx.fps),
        sec,
        beatEndSec: event.beatEndSec,
        ...(params ? { params } : {}),
        ...(untilSec !== undefined ? { untilSec } : {}),
      },
    ];
  });
}

/**
 * The items an event acts on and how many share its stagger: its parts (one target), else its
 * keys. A scan places parts by their position in the element's own part order.
 */
function itemsOf(
  event: AnchoredEvent,
  keys: readonly string[],
  mode: StaggerMode | 'default',
  ctx: ResolveContext,
): { items: Item[]; count: number } {
  const parts = eventParts(event.params);
  const [key] = keys;
  if (!parts || key === undefined || keys.length > 1) {
    return { items: keys.map((k, position) => ({ key: k, position })), count: keys.length };
  }
  const order = mode === 'scan' ? ctx.partOrder(key) : [];
  const items = parts.map((part, i) => {
    const inOrder = order.indexOf(part);
    return { key, part, position: inOrder >= 0 ? inOrder : i };
  });
  return { items, count: order.length > 0 ? order.length : parts.length };
}

/** Seconds between consecutive items of a group of `count`. */
export function staggerStep(count: number, mode: StaggerMode | 'default', roomSec: number) {
  if (count <= 1) return 0;
  if (mode === 'scan') return Math.max(0, Math.min(SCAN_STEP_SEC, roomSec / (count - 1)));
  return Math.min(STAGGER_STEP_SEC, STAGGER_MAX_SEC / (count - 1));
}

/**
 * Seconds between the items of a scan over `count` items: its step, squeezed so the sweep ends by
 * `SCAN_MAX_SEC` and by the beat's next event (`all`: every event of the chain).
 */
export function scanStep(event: AnchoredEvent, all: readonly AnchoredEvent[], count: number) {
  const room = Math.min(SCAN_MAX_SEC, nextEventSec(event, all) - event.sec);
  return staggerStep(count, 'scan', room);
}

/** The next event anchored later in the same beat, else the beat's end. */
export function nextEventSec(event: AnchoredEvent, all: readonly AnchoredEvent[]): number {
  const later = all
    .filter((e) => e.beatStartSec === event.beatStartSec && e.sec > event.sec + SIMULTANEOUS_SEC)
    .map((e) => e.sec);
  return Math.min(event.beatEndSec, ...later);
}

/** A highlight leads its word (never before its beat); every other action starts on it. */
function startSec(event: AnchoredEvent): number {
  if (event.action !== 'highlight') return event.sec;
  return Math.max(event.beatStartSec, event.sec - HIGHLIGHT_LEAD_SEC);
}

/**
 * When a highlight starting at `sec` begins to fade, so it is gone when its scene leaves the
 * screen or at the next focus change after its word; never before it has fully come on. Undefined for other
 * actions and for held highlights.
 */
function clearSec(
  event: AnchoredEvent,
  sec: number,
  focusChanges: readonly number[],
): number | undefined {
  if (event.action !== 'highlight' || eventHolds(event.params)) return undefined;
  const duration = ACTION_DURATION_SEC.highlight;
  const nextChange = focusChanges.filter((c) => c > event.sec + SIMULTANEOUS_SEC);
  const boundary = Math.min(event.sceneEndSec, ...nextChange);
  return Math.max(sec + duration, boundary - duration);
}
