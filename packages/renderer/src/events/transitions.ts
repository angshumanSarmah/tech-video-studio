import type { BeatScene, Transition } from '@explainer-studio/shared';
import type { BeatFrameSpan } from '../timing/frames.ts';
import { easeInOutCubic, easeOutCubic, TRANSITION_SEC } from './presets.ts';

/**
 * Beat transitions (`transitionIn`), anchored to beat edges with fixed durations. Only a beat
 * that starts a new board has one; a continuing beat keeps its board (the camera eases instead).
 * - `fade`, `slide`, `zoom-in`, `zoom-out`: the two boards overlap for `TRANSITION_SEC` from the
 *   incoming beat's start; the outgoing beat's scene runs on underneath until it ends.
 * - semantic zoom (`zoom-in` with `zoomFrom`): the outgoing camera has already pushed into the
 *   element (`camera-track.ts`), so the boards do not overlap: a cut, then the incoming board
 *   settles, continuing the push.
 * Pure: `BeatScene` turns a view into CSS.
 */

export type TransitionSide = 'in' | 'out';

export type ActiveTransition = {
  kind: Transition;
  side: TransitionSide;
  /** True for a semantic zoom (`zoomFrom`). */
  semantic: boolean;
  /** Global frame it starts at, and how many frames it runs. */
  from: number;
  frames: number;
};

/** A beat's scene span with the transitions it plays (extended under an overlapping incoming). */
export type SceneSpan = BeatFrameSpan & { transitions: ActiveTransition[] };

/** The transition into the scene at `index`: none on the first beat, a continuing one, or a cut. */
export function incomingTransition(
  scene: BeatScene | undefined,
  index: number,
): { kind: Transition; semantic: boolean } | undefined {
  if (!scene || index === 0 || scene.continuesPrevious || scene.transitionIn === 'cut') {
    return undefined;
  }
  const semantic = scene.transitionIn === 'zoom-in' && scene.zoomFrom !== undefined;
  return { kind: scene.transitionIn, semantic };
}

/** Frames a transition runs at `fps` (at least one). */
export function transitionFrames(fps: number): number {
  return Math.max(1, Math.round(TRANSITION_SEC * fps));
}

/**
 * Scene spans with their transitions: each beat with a transition in plays its `in` side from its
 * start; when the boards overlap, the previous beat's span runs on for the transition and plays
 * its `out` side. With `cuts` (one beat cut from the timeline, `BeatFromSpec`) every transition
 * is a cut and the spans are the beat spans.
 */
export function sceneSpans(
  spans: readonly BeatFrameSpan[],
  scenes: readonly BeatScene[],
  fps: number,
  { cuts = false }: { cuts?: boolean } = {},
): SceneSpan[] {
  const out: SceneSpan[] = spans.map((span) => ({ ...span, transitions: [] }));
  if (cuts) return out;
  const frames = transitionFrames(fps);
  spans.forEach((span, i) => {
    const index = scenes.findIndex((s) => s.beatId === span.beatId);
    const t = incomingTransition(scenes[index], index);
    const previous = out[i - 1];
    if (!t || !previous) return;
    const base = { kind: t.kind, semantic: t.semantic, from: span.from, frames };
    out[i]?.transitions.push({ ...base, side: 'in' });
    if (t.semantic) return;
    previous.durationInFrames += frames;
    previous.transitions.push({ ...base, side: 'out' });
  });
  return out;
}

/**
 * How a board looks during a transition: opacity, scale about the board's centre and a
 * horizontal shift as a fraction of the board's width. Undefined outside its window (drawn as is).
 */
export type TransitionView = { opacity: number; scale: number; shift: number };

export function transitionView(t: ActiveTransition, frame: number): TransitionView | undefined {
  const p = (frame - t.from) / t.frames;
  if (p < 0 || p >= 1 || t.kind === 'cut') return undefined;
  const e = easeInOutCubic(p);
  const incoming = t.side === 'in';
  if (t.semantic) return { opacity: 1, scale: 0.9 + 0.1 * easeOutCubic(p), shift: 0 };
  switch (t.kind) {
    case 'fade':
      // The incoming board fades in over the outgoing one, which stays put underneath.
      return incoming ? { opacity: e, scale: 1, shift: 0 } : undefined;
    case 'slide':
      return { opacity: 1, scale: 1, shift: incoming ? 1 - e : -e };
    case 'zoom-in':
      return incoming
        ? { opacity: e, scale: 0.85 + 0.15 * e, shift: 0 }
        : { opacity: 1 - e, scale: 1 + 0.3 * e, shift: 0 };
    case 'zoom-out':
      return incoming
        ? { opacity: e, scale: 1.2 - 0.2 * e, shift: 0 }
        : { opacity: 1 - e, scale: 1 - 0.2 * e, shift: 0 };
  }
}

/** The view of the transition active at `frame`, if any. */
export function activeView(
  transitions: readonly ActiveTransition[],
  frame: number,
): TransitionView | undefined {
  for (const t of transitions) {
    const view = transitionView(t, frame);
    if (view) return view;
  }
  return undefined;
}
