import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { ACTION_DURATION_SEC } from '../events/presets.ts';
import type { ElementEvent } from '../primitives/element-state.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { renderedWorld } from '../scene/rendered-world.ts';
import { getTheme } from '../theme/index.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/** Any fps works: event seconds do not depend on it. */
const SETTLE_FPS = 30;
/** Rounding slack when matching an event to the beat it is anchored in (seconds). */
const EPSILON_SEC = 1e-6;

/** When the latest non-exit event has played out (draws included); undefined without one. */
export function settledSec(events: readonly ElementEvent[]): number | undefined {
  const ends = events
    .filter((e) => e.action !== 'exit')
    .map((e) => e.sec + Math.max(ACTION_DURATION_SEC[e.action], e.drawSec ?? 0));
  return ends.length > 0 ? Math.max(...ends) : undefined;
}

export function flattenWorld(items: readonly WorldItem[]): WorldItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.kind === 'primitive' ? flattenWorld(item.children) : []),
  ]);
}

/**
 * Per beat with events: seconds from the beat's start until its last event has settled (played
 * out, draws, staggers and scans included), measured on the world as `BeatScene` renders it in
 * the default video theme. Only events anchored in that beat count. The timing step adds the
 * landing hold after this point. Offsets do not depend on where the beat sits on the track, so
 * any timing (estimated or real, with or without pauses) gives the same result. Pure.
 */
export function beatSettledOffsets(
  spec: RenderableVideoSpec,
  { registries = DEFAULT_REGISTRIES }: { registries?: Registries } = {},
): Map<string, number> {
  const timing = effectiveTiming(spec);
  const theme = getTheme();
  const offsets = new Map<string, number>();
  for (const beat of timing.beats) {
    if (!spec.scenes.some((s) => s.beatId === beat.beatId)) continue;
    const world = renderedWorld(spec, timing, beat.beatId, SETTLE_FPS, registries, theme);
    const own = flattenWorld(world).flatMap((item) =>
      item.kind === 'primitive'
        ? item.events.filter((e) => Math.abs(e.beatEndSec - beat.endSec) < EPSILON_SEC)
        : [],
    );
    const settled = settledSec(own);
    if (settled !== undefined) offsets.set(beat.beatId, settled - beat.startSec);
  }
  return offsets;
}
