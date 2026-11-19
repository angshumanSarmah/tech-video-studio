import type { PartState } from './element-state.ts';

/**
 * Entrance motions for overlays and other elements that do not use `stateStyle`'s grow-in.
 * Pure: components spread the returned opacity and transform.
 */

/** How strongly a dimmed element fades (the same factor as `stateStyle`). */
const DIM_FADE = 0.7;

/** Scale bump while emphasised (the same factor as `stateStyle`). */
const EMPHASIS_GROW = 0.06;

export type MotionView = { opacity: number; transform: string };

/** Fade and a slight rise: `rise` px below its place while absent, in place when present. */
export function riseView(state: PartState, rise: number): MotionView {
  const offset = (1 - state.presence) * rise;
  const scale = 1 + EMPHASIS_GROW * state.emphasis;
  return {
    opacity: state.presence * (1 - DIM_FADE * state.dimmed),
    transform: `translateY(${round(offset)}px) scale(${round(scale)})`,
  };
}

/** Scale an inset starts from (and shrinks back to): a small card at its anchor. */
export const ZOOM_FROM = 0.15;

/**
 * Zoom out of an anchor on `enter`, shrink back into it on `exit`: scale follows presence from
 * `ZOOM_FROM` to 1, and the panel turns opaque in the first half of the zoom.
 */
export function zoomView(state: PartState): MotionView {
  const scale =
    (ZOOM_FROM + (1 - ZOOM_FROM) * state.presence) * (1 + EMPHASIS_GROW * state.emphasis);
  return {
    opacity: Math.min(1, 2 * state.presence) * (1 - DIM_FADE * state.dimmed),
    transform: `scale(${round(scale)})`,
  };
}

/** Grow from the centre (a ring spreading out): scale follows presence from 0. */
export function growView(state: PartState): MotionView {
  const scale = state.presence * (1 + EMPHASIS_GROW * state.emphasis);
  return {
    opacity: Math.min(1, 2 * state.presence) * (1 - DIM_FADE * state.dimmed),
    transform: `scale(${round(scale)})`,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
