import type { ElementState } from '../primitives/element-state.ts';
import type { WorldItem } from './beat-world.ts';

/**
 * How a beat's items stack: board items in the stage, then the overlays (with their children
 * inside them). While an overlay shows, focus moves to it and the board dims through each
 * element's `dimmed` (the focus track, `events/focus.ts`), so there is no separate scrim. Pure:
 * `BeatScene` draws what this returns.
 */

export type PrimitiveItem = Extract<WorldItem, { kind: 'primitive' }>;

export type SceneLayers = { board: WorldItem[]; overlays: PrimitiveItem[] };

export function splitLayers(items: readonly WorldItem[]): SceneLayers {
  const overlays = items.filter(
    (item): item is PrimitiveItem => item.kind === 'primitive' && item.layer === 'overlay',
  );
  return { board: items.filter((item) => !overlays.includes(item as PrimitiveItem)), overlays };
}

/**
 * How much the board's own decoration (the mode's guide lines) dims for overlays: the most
 * present overlay, 0 (none) to 1 (one fully shown). Elements dim through their focus track.
 */
export function overlayLevel(overlayPresences: readonly number[]): number {
  return Math.max(0, ...overlayPresences);
}

/**
 * A contained element shows only while its container does: its presence is multiplied by the
 * container's, so it enters and exits with it.
 */
export function containedState(state: ElementState, containerPresence: number): ElementState {
  return { ...state, presence: state.presence * containerPresence };
}
