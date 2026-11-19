import { dimOpacity } from '../events/presets.ts';
import type { PartState } from './element-state.ts';

/**
 * For lines that draw themselves on `enter` instead of fading in (`connector`, `route_path`):
 * `draw` is the drawn fraction (1 when the element has no `enter`), and `opacity` stays full
 * while drawing, fades out on `exit`, and fades on `dim`. While an `enter` plays, presence equals
 * its progress, so `presence / draw` is 1; after an `exit` it falls with presence.
 */
export function revealState(state: PartState): { draw: number; opacity: number } {
  const draw = state.actions.enter ?? 1;
  const shown = draw > 0 ? Math.min(1, state.presence / draw) : 0;
  return { draw, opacity: shown * dimOpacity(state.dimmed) };
}
