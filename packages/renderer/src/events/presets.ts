import type { EventAction } from '@explainer-studio/shared';

/**
 * Presets of the event engine: how long each action plays and how it eases, how groups stagger,
 * how highlights lead and clear, how strongly dimmed things fade, and how cameras and beat
 * transitions move. All in seconds (the spec's unit), so drafts (15 fps) match finals (30).
 * React-free.
 */

export type Easing = (t: number) => number;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const linear: Easing = (t) => clamp01(t);
export const easeOutCubic: Easing = (t) => 1 - (1 - clamp01(t)) ** 3;
export const easeInCubic: Easing = (t) => clamp01(t) ** 3;
export const easeInOutCubic: Easing = (t) => {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c ** 3 : 1 - (-2 * c + 2) ** 3 / 2;
};

/** Seconds each action takes to play out. */
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
  release: 0.4,
  reject: 0.5,
  recover: 0.6,
  pulse: 0.6,
};

/**
 * How each action eases. None overshoots: components use progress directly as opacity. Arrivals
 * decelerate (ease-out), departures accelerate (ease-in), travel and state changes ease both
 * ways, and a pulse is linear so its sine bump is symmetric.
 */
export const ACTION_EASING: Record<EventAction, Easing> = {
  enter: easeOutCubic,
  exit: easeInCubic,
  highlight: easeInOutCubic,
  dim: easeInOutCubic,
  focus: easeInOutCubic,
  move: easeInOutCubic,
  morph: easeInOutCubic,
  count: easeOutCubic,
  lock: easeOutCubic,
  release: easeInOutCubic,
  reject: easeOutCubic,
  recover: easeOutCubic,
  pulse: linear,
};

/**
 * The one dim strength: a fully dimmed element (an explicit `dim`, out of focus, or on the board
 * behind an overlay) keeps `1 - DIM_FADE` of its opacity.
 */
export const DIM_FADE = 0.7;

/** Opacity factor for a `dimmed` level (0..1). */
export function dimOpacity(dimmed: number): number {
  return 1 - DIM_FADE * dimmed;
}

/** Actions a group (several targets, an instance, or several parts) staggers by default. */
export const STAGGERED_ACTIONS: ReadonlySet<EventAction> = new Set([
  'enter',
  'exit',
  'highlight',
  'dim',
  'pulse',
]);

/** Default group stagger: seconds between items, and the most the whole group may spread. */
export const STAGGER_STEP_SEC = 0.06;
export const STAGGER_MAX_SEC = 0.3;

/**
 * `params.stagger: 'scan'`, a deliberate one-by-one sweep (any action): seconds between items,
 * and the most it may spread (also never past the beat's next event).
 */
export const SCAN_STEP_SEC = 0.15;
export const SCAN_MAX_SEC = 2;

/** Below this step a scan no longer reads as one by one (`scan_too_short`). */
export const SCAN_MIN_STEP_SEC = 0.08;

/** A highlight starts this long before its anchor word (never before its beat starts). */
export const HIGHLIGHT_LEAD_SEC = 0.2;

/** A camera move (a new beat in a chain, a focus change) eases over this long. */
export const CAMERA_EASE_SEC = 0.6;

/** A beat transition (fade, slide, zoom-in, zoom-out) overlaps the two boards this long. */
export const TRANSITION_SEC = 0.4;

/** A semantic zoom pushes into its element over the last this-long of the previous beat. */
export const ZOOM_PUSH_SEC = 0.5;

/**
 * How far a semantic-zoom push goes: until its element is this many times the size that fills
 * the frame (into it, not just up to it), right before the cut.
 */
export const ZOOM_PUSH_FILL = 2.5;
