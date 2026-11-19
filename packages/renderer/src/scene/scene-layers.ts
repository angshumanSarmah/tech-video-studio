import type { ElementState } from '../primitives/element-state.ts';
import { withAlpha, type Theme } from '../theme/index.ts';
import type { WorldItem } from './beat-world.ts';

/**
 * How a beat's items stack: board items in the stage, then a scrim that dims the board while an
 * overlay shows, then the overlays (with their children inside them, so the scrim never dims
 * them). Pure: `BeatScene` draws what this returns.
 */

export type PrimitiveItem = Extract<WorldItem, { kind: 'primitive' }>;

export type SceneLayers = { board: WorldItem[]; overlays: PrimitiveItem[] };

export function splitLayers(items: readonly WorldItem[]): SceneLayers {
  const overlays = items.filter(
    (item): item is PrimitiveItem => item.kind === 'primitive' && item.layer === 'overlay',
  );
  return { board: items.filter((item) => !overlays.includes(item as PrimitiveItem)), overlays };
}

/** How strongly the scrim dims the board at full strength. */
export const SCRIM_ALPHA = 0.72;

/** The scrim follows the most present overlay: 0 (none) to 1 (one fully shown). */
export function scrimLevel(overlayPresences: readonly number[]): number {
  return Math.max(0, ...overlayPresences);
}

/** The scrim's colour: the theme background over the board, at `level` of full strength. */
export function scrimColour(theme: Theme, level: number): string {
  return withAlpha(theme.colours.background, SCRIM_ALPHA * level);
}

/**
 * A contained element shows only while its container does: its presence is multiplied by the
 * container's, so it enters and exits with it.
 */
export function containedState(state: ElementState, containerPresence: number): ElementState {
  return { ...state, presence: state.presence * containerPresence };
}
