import type { WorldItem } from '../scene/beat-world.ts';
import type { SheetPanel } from './primitive-sheet.ts';

/**
 * Sheet panels in the `draw` enter style show finished draws: a panel moves to the latest draw end
 * (any element of its beat, children included) that comes after its frame and before the next
 * moment. In the fade style no event draws, so panels stay where the planner put them. Pure.
 */
export function settleDraws(
  panels: readonly SheetPanel[],
  world: readonly WorldItem[],
  fps: number,
): SheetPanel[] {
  const ends = drawEnds(world, fps);
  return panels.map((panel) => {
    const later = ends.filter((end) => end > panel.frame && end < panel.before);
    return later.length > 0 ? { ...panel, frame: Math.max(...later) } : panel;
  });
}

/** The first frame after each draw has ended. */
function drawEnds(items: readonly WorldItem[], fps: number): number[] {
  return items.flatMap((item) =>
    item.kind === 'primitive'
      ? [
          ...item.events.flatMap((e) =>
            e.drawSec !== undefined ? [Math.ceil((e.sec + e.drawSec) * fps)] : [],
          ),
          ...drawEnds(item.children, fps),
        ]
      : [],
  );
}
