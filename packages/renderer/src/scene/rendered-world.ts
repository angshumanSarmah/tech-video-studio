import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import type { Registries } from '../catalog/registries.ts';
import { specLayout } from '../layout/spec-layout.ts';
import type { BoardLayout, PlacedItem } from '../layout/types.ts';
import type { Theme } from '../theme/index.ts';
import { beatWorld, type WorldItem } from './beat-world.ts';

/**
 * A beat's world as `BeatScene` renders it in `theme`: its enter style, and draw durations from
 * the placed layout (`specLayout`). Validation (`draw_cut_short`) reads the same, so the warning
 * and the render agree. Pure.
 */
export function renderedWorld(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  beatId: string,
  fps: number,
  registries: Registries,
  theme: Theme,
): WorldItem[] {
  const beat = specLayout(spec, theme, registries).beats.get(beatId);
  const placed = beat ? placedByKey(beat.chain.board) : new Map<string, PlacedItem>();
  return beatWorld(spec, timing, beatId, fps, registries, {
    theme,
    placedOf: (key) => placed.get(key),
  });
}

/** Every placed item of a board (board items, overlays and their children) by key. */
export function placedByKey(board: BoardLayout): Map<string, PlacedItem> {
  const out = new Map<string, PlacedItem>();
  const add = (items: readonly PlacedItem[]) => {
    for (const item of items) {
      out.set(item.key, item);
      add(item.children ?? []);
    }
  };
  add(board.items);
  add(board.overlays);
  return out;
}
