import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { ACTION_DURATION_SEC, ZOOM_PUSH_SEC } from '../events/presets.ts';
import type { ElementEvent } from '../primitives/element-state.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { renderedWorld } from '../scene/rendered-world.ts';
import { getTheme } from '../theme/index.ts';
import { beatFrameSpans, secToFrame, type BeatFrameSpan } from '../timing/frames.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

export type KeyFrameOptions = { themeId?: string; registries?: Registries };

/**
 * The frame of a beat that best previews it (a still per beat): when its last event that is not an
 * `exit` has played out (draws included), so the board shows everything the beat brings on. A beat
 * without such events uses the middle of its span. Kept before the span's last `ZOOM_PUSH_SEC`
 * (a semantic-zoom push into the next beat) and inside the span. Pure.
 *
 * Returns the frame relative to the beat's own clip (`BeatFromSpec` frame 0 = the beat's start).
 */
export function beatKeyFrame(
  spec: RenderableVideoSpec,
  beatId: string,
  fps: number,
  { themeId, registries = DEFAULT_REGISTRIES }: KeyFrameOptions = {},
): number {
  const timing = effectiveTiming(spec);
  const span = beatFrameSpans(timing, fps).find((s) => s.beatId === beatId);
  if (!span) throw new Error(`Unknown beat "${beatId}".`);
  const world = renderedWorld(spec, timing, beatId, fps, registries, getTheme(themeId));
  const settled = settledSec(beatEvents(world, span, fps));
  const fromSec = span.from / fps;
  const endSec = (span.from + span.durationInFrames) / fps;
  const keySec = settled ?? (fromSec + endSec) / 2;
  const pushFrames = Math.ceil(ZOOM_PUSH_SEC * fps);
  const latest = Math.max(span.from, span.from + span.durationInFrames - pushFrames - 1);
  return Math.min(Math.max(secToFrame(keySec, fps), span.from), latest) - span.from;
}

/** The events of every item (children included) that start inside the beat's span. */
function beatEvents(items: readonly WorldItem[], span: BeatFrameSpan, fps: number): ElementEvent[] {
  const fromSec = span.from / fps;
  const endSec = (span.from + span.durationInFrames) / fps;
  return flatten(items).flatMap((item) =>
    item.kind === 'primitive' ? item.events.filter((e) => e.sec >= fromSec && e.sec < endSec) : [],
  );
}

function flatten(items: readonly WorldItem[]): WorldItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.kind === 'primitive' ? flatten(item.children) : []),
  ]);
}

/** When the latest non-exit event has played out; undefined when there is none. */
function settledSec(events: readonly ElementEvent[]): number | undefined {
  const ends = events
    .filter((e) => e.action !== 'exit')
    .map((e) => e.sec + Math.max(ACTION_DURATION_SEC[e.action], e.drawSec ?? 0));
  return ends.length > 0 ? Math.max(...ends) : undefined;
}
