import type { EventAction } from '@explainer-studio/shared';
import { eventParts } from './parts.ts';

/**
 * The single place where anchored events become per-frame element state. Components receive only
 * `ElementState`, never events or anchors. Deliberately simple for now (linear ramps with an
 * ease-out); P1A.10 upgrades it (easing presets, focus, stagger) without touching components.
 */

/** One event acting on an element, on the global timeline (already resolved from its anchor). */
export type ElementEvent = {
  action: EventAction;
  /** Global frame: the event has started once the current frame reaches it. */
  frame: number;
  /** Global seconds, unrounded: elapsed time is measured from here, so every fps agrees. */
  sec: number;
  /** End (global seconds) of the beat the event is anchored in. */
  beatEndSec: number;
  params?: Record<string, unknown>;
};

export type ElementState = {
  /** 0 = absent, 1 = fully present (enter / exit). */
  presence: number;
  /** 0..1: a held `highlight`, or the bump of a `pulse` (the larger of the two). */
  emphasis: number;
  /** 0..1: the held `highlight` alone (no pulse), for emphasis styles that draw them apart. */
  highlight: number;
  /** 0..1: ramps up after `dim`, back down after a later `highlight` or `enter`. */
  dimmed: number;
  /**
   * Progress (0..1) of the latest started occurrence of each action the element has; 0 while its
   * first occurrence is still ahead; absent when the element has no event with that action.
   * Exception: `reject` is held, and reads 0 again once a later `recover` has started.
   */
  actions: Partial<Record<EventAction, number>>;
  /**
   * Seconds since the latest started occurrence of each action, on the global timeline (current
   * frame / fps minus the event's resolved seconds), so a beat cut renders exactly like the full
   * video. Same presence rules as `actions`: 0 while the first occurrence is ahead, absent when
   * the element has none. For effects that run longer than an action's fixed duration (typing,
   * a ticking timer).
   */
  elapsed: Partial<Record<EventAction, number>>;
  /**
   * Seconds each action's occurrence runs (`actionRunSec`), for the latest started occurrence or,
   * before any has started, the first one ahead. Absent when the element has no such event. Lets
   * a component pace a process to the narration (a timer reaching 00:00 on the expiry word)
   * without seeing events.
   */
  runSec: Partial<Record<EventAction, number>>;
  /**
   * How many occurrences of each action have started (0 while the first is ahead; absent when the
   * element has none), for components that step once per occurrence (a jumpy `route_path` mover).
   */
  starts: Partial<Record<EventAction, number>>;
  /**
   * State of each part named by an event's `params.parts`, from those events only (the same
   * rules as the whole element). Parts no event names are absent: read them with `partState`.
   */
  parts: Record<string, PartState>;
};

/** A part's state: the same fields as the element's, without nesting. */
export type PartState = Omit<ElementState, 'parts'>;

/** A part (or element) no event acts on: present, idle. */
export const IDLE_STATE: PartState = {
  presence: 1,
  emphasis: 0,
  highlight: 0,
  dimmed: 0,
  actions: {},
  elapsed: {},
  runSec: {},
  starts: {},
};

/** State of one part; `IDLE_STATE` when no event names it. */
export function partState(state: ElementState, partId: string): PartState {
  return Object.hasOwn(state.parts, partId) ? (state.parts[partId] ?? IDLE_STATE) : IDLE_STATE;
}

/** Seconds each action takes to play out; scaled by fps so drafts (15) match finals (30). */
export const ACTION_DURATION_SEC: Record<EventAction, number> = {
  enter: 0.45,
  exit: 0.35,
  highlight: 0.3,
  dim: 0.3,
  focus: 0.3,
  move: 0.6,
  morph: 0.6,
  count: 0.9,
  lock: 0.4,
  reject: 0.5,
  recover: 0.6,
  pulse: 0.6,
};

const PRESENCE: ReadonlySet<EventAction> = new Set(['enter', 'exit']);
const DIM_TOGGLES: ReadonlySet<EventAction> = new Set(['dim', 'highlight', 'enter']);
/** A held highlight ends at a later dim, exit or reject (a new highlight after it starts again). */
const HIGHLIGHT_TOGGLES: ReadonlySet<EventAction> = new Set(['highlight', 'dim', 'exit', 'reject']);
/**
 * A reject is held until a later `recover` (and only that: highlight, enter, pulse and lock leave
 * it). `actions.reject` then reads 0, so every component drops its problem look by itself.
 */
const REJECT_TOGGLES: ReadonlySet<EventAction> = new Set(['reject', 'recover']);
/** Peak of the settle bump a `recover` plays in the element's own colour. */
const SETTLE_PEAK = 0.6;

/**
 * State at global `frame`; elapsed times use `frame / fps` as the absolute video time. Events that
 * name parts (`params.parts`) drive only those parts; the rest drive the whole element.
 */
export function elementState(
  events: readonly ElementEvent[],
  frame: number,
  fps: number,
): ElementState {
  const whole = events.filter((e) => !eventParts(e.params));
  return { ...stateOf(whole, frame, fps), parts: partStates(events, frame, fps) };
}

function partStates(events: readonly ElementEvent[], frame: number, fps: number) {
  const byPart = new Map<string, ElementEvent[]>();
  for (const event of events) {
    for (const id of eventParts(event.params) ?? []) {
      byPart.set(id, [...(byPart.get(id) ?? []), event]);
    }
  }
  return Object.fromEntries(
    [...byPart].map(([id, partEvents]) => [id, stateOf(partEvents, frame, fps)]),
  );
}

function stateOf(events: readonly ElementEvent[], frame: number, fps: number): PartState {
  const started = events.filter((e) => e.frame <= frame).sort((a, b) => a.frame - b.frame);
  const progress = (e: ElementEvent) => actionProgress(e, frame, fps);
  const elapsed = (e: ElementEvent) => Math.max(0, frame / fps - e.sec);
  const highlight = heldLevel(started, 'highlight', HIGHLIGHT_TOGGLES, progress);
  const actions = latestPerAction(events, started, progress);
  if (actions.reject !== undefined) {
    actions.reject = heldLevel(started, 'reject', REJECT_TOGGLES, progress);
  }
  return {
    presence: presence(events, started, progress),
    emphasis: Math.max(highlight, pulse(started, progress), settle(started, progress)),
    highlight,
    dimmed: heldLevel(started, 'dim', DIM_TOGGLES, progress),
    actions,
    elapsed: latestPerAction(events, started, elapsed),
    runSec: runPerAction(events, started),
    starts: startsPerAction(events, started),
  };
}

/**
 * How long an occurrence of an action runs, from resolved event times: until the element's next
 * `reject` after it; without one, until its next `exit` or the end of the beat the occurrence is
 * anchored in, whichever comes first. Never negative.
 */
export function actionRunSec(event: ElementEvent, events: readonly ElementEvent[]): number {
  const after = events.filter((e) => e.sec > event.sec).sort((a, b) => a.sec - b.sec);
  const reject = after.find((e) => e.action === 'reject');
  if (reject) return reject.sec - event.sec;
  const exit = after.find((e) => e.action === 'exit');
  return Math.max(0, Math.min(exit?.sec ?? Infinity, event.beatEndSec) - event.sec);
}

/** Started occurrences per action; 0 for actions whose first event is ahead. */
function startsPerAction(all: readonly ElementEvent[], started: readonly ElementEvent[]) {
  const counts: Partial<Record<EventAction, number>> = {};
  for (const event of all) counts[event.action] = 0;
  for (const event of started) counts[event.action] = (counts[event.action] ?? 0) + 1;
  return counts;
}

/** `actionRunSec` of the latest started occurrence per action, else of its first one ahead. */
function runPerAction(all: readonly ElementEvent[], started: readonly ElementEvent[]) {
  const runs: Partial<Record<EventAction, number>> = {};
  const ahead = [...all].sort((a, b) => b.sec - a.sec);
  for (const event of ahead) runs[event.action] = actionRunSec(event, all);
  for (const event of started) runs[event.action] = actionRunSec(event, all);
  return runs;
}

/** Eased 0..1 progress of one event at `frame`. */
export function actionProgress(event: ElementEvent, frame: number, fps: number): number {
  const frames = Math.max(1, Math.round(ACTION_DURATION_SEC[event.action] * fps));
  return easeOut((frame - event.frame) / frames);
}

/** The easing every action uses (ease-out cubic), for linear progress `t`, clamped to 0..1. */
export function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

type Progress = (e: ElementEvent) => number;

/**
 * Present from the start unless the element's first `enter` / `exit` is an `enter` (so an element
 * that exits and later re-enters starts present); then follows the latest one that has started.
 */
function presence(all: readonly ElementEvent[], started: readonly ElementEvent[], p: Progress) {
  const last = started.findLast((e) => PRESENCE.has(e.action));
  if (!last) {
    const first = [...all].sort((a, b) => a.frame - b.frame).find((e) => PRESENCE.has(e.action));
    return first?.action === 'enter' ? 0 : 1;
  }
  return last.action === 'enter' ? p(last) : 1 - p(last);
}

/** Ramps to 1 after `on`, held until a later toggle of another action. */
function heldLevel(
  started: readonly ElementEvent[],
  on: EventAction,
  toggles: ReadonlySet<EventAction>,
  p: Progress,
) {
  const last = started.findLast((e) => toggles.has(e.action));
  return last?.action === on ? p(last) : 0;
}

/** A bump that rises and falls back to 0 over the pulse's duration. */
function pulse(started: readonly ElementEvent[], p: Progress) {
  const last = started.findLast((e) => e.action === 'pulse');
  return last ? Math.sin(Math.PI * p(last)) : 0;
}

/** The short bump a `recover` plays as the element settles back into its own colour. */
function settle(started: readonly ElementEvent[], p: Progress) {
  const last = started.findLast((e) => e.action === 'recover');
  return last ? SETTLE_PEAK * Math.sin(Math.PI * p(last)) : 0;
}

/** `measure` of the latest started event per action; 0 for actions whose first event is ahead. */
function latestPerAction(
  all: readonly ElementEvent[],
  started: readonly ElementEvent[],
  measure: (e: ElementEvent) => number,
) {
  const values: Partial<Record<EventAction, number>> = {};
  for (const event of all) values[event.action] = 0;
  for (const event of started) values[event.action] = measure(event);
  return values;
}
