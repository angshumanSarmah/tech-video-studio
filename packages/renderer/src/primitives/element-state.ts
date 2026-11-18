import type { EventAction } from '@explainer-studio/shared';

/**
 * The single place where anchored events become per-frame element state. Components receive only
 * `ElementState`, never events or anchors. Deliberately simple for now (linear ramps with an
 * ease-out); P1A.10 upgrades it (easing presets, focus, stagger) without touching components.
 */

/** One event acting on an element, at a global frame (already resolved from its anchor). */
export type ElementEvent = {
  action: EventAction;
  frame: number;
  params?: Record<string, unknown>;
};

export type ElementState = {
  /** 0 = absent, 1 = fully present (enter / exit). */
  presence: number;
  /** 0..1: a held `highlight`, or the bump of a `pulse`. */
  emphasis: number;
  /** 0..1: ramps up after `dim`, back down after a later `highlight` or `enter`. */
  dimmed: number;
  /** Progress (0..1) of the latest started occurrence of each action; absent until it starts. */
  actions: Partial<Record<EventAction, number>>;
};

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
  pulse: 0.6,
};

const PRESENCE: ReadonlySet<EventAction> = new Set(['enter', 'exit']);
const DIM_TOGGLES: ReadonlySet<EventAction> = new Set(['dim', 'highlight', 'enter']);
const HIGHLIGHT_TOGGLES: ReadonlySet<EventAction> = new Set(['highlight', 'dim', 'exit']);

export function elementState(
  events: readonly ElementEvent[],
  frame: number,
  fps: number,
): ElementState {
  const started = events.filter((e) => e.frame <= frame).sort((a, b) => a.frame - b.frame);
  const progress = (e: ElementEvent) => actionProgress(e, frame, fps);
  return {
    presence: presence(events, started, progress),
    emphasis: Math.max(
      heldLevel(started, 'highlight', HIGHLIGHT_TOGGLES, progress),
      pulse(started, progress),
    ),
    dimmed: heldLevel(started, 'dim', DIM_TOGGLES, progress),
    actions: latestProgress(started, progress),
  };
}

/** Eased 0..1 progress of one event at `frame`. */
export function actionProgress(event: ElementEvent, frame: number, fps: number): number {
  const frames = Math.max(1, Math.round(ACTION_DURATION_SEC[event.action] * fps));
  const t = Math.min(1, Math.max(0, (frame - event.frame) / frames));
  return 1 - (1 - t) ** 3;
}

type Progress = (e: ElementEvent) => number;

/** Present from the start unless the element has an `enter`; then from that `enter` until `exit`. */
function presence(all: readonly ElementEvent[], started: readonly ElementEvent[], p: Progress) {
  const last = started.findLast((e) => PRESENCE.has(e.action));
  if (!last) return all.some((e) => e.action === 'enter') ? 0 : 1;
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

function latestProgress(started: readonly ElementEvent[], p: Progress) {
  const actions: Partial<Record<EventAction, number>> = {};
  for (const event of started) actions[event.action] = p(event);
  return actions;
}
