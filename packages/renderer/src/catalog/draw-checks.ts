import {
  effectiveTiming,
  toJsonPath,
  type BeatScene,
  type RenderableVideoSpec,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import { ACTION_DURATION_SEC } from '../events/presets.ts';
import type { ElementEvent } from '../primitives/element-state.ts';
import { eventParts } from '../primitives/parts.ts';
import type { WorldItem } from '../scene/beat-world.ts';
import { renderedWorld } from '../scene/rendered-world.ts';
import { getTheme, type Theme } from '../theme/index.ts';
import type { Registries } from './registries.ts';

/**
 * `draw_cut_short`: an element's `enter` whose draw (or fade) would not finish while its scene is
 * on screen, so it is cut off half drawn. The scene shows until the next beat starts (or the video
 * ends); a beat that the next one continues hands the element over still drawing, which is fine
 * unless it exits first. Durations come from the beat's world exactly as `BeatScene` renders it
 * (`renderedWorld`) in the default video theme. Needs the script (timing real or estimated).
 */

type Path = (string | number)[];

/** Rounding slack (seconds). */
const EPSILON_SEC = 1e-3;

/** Any fps works: the check reads event seconds. */
const CHECK_FPS = 30;

export function drawCutShortWarnings(
  spec: VideoSpec,
  registries: Registries,
  theme: Theme = getTheme(),
): SpecError[] {
  const { script, scenes } = spec;
  if (!script || !scenes) return [];
  const renderable: RenderableVideoSpec = { ...spec, script, scenes };
  const timing = effectiveTiming(renderable);
  return scenes.flatMap((scene, i) => {
    const beat = timing.beats.find((b) => b.beatId === scene.beatId);
    if (!beat) return [];
    const index = timing.beats.indexOf(beat);
    const shownUntil = timing.beats[index + 1]?.startSec ?? timing.endSec;
    const continued = scenes[i + 1]?.continuesPrevious === true;
    const world = renderedWorld(renderable, timing, scene.beatId, CHECK_FPS, registries, theme);
    return flat(world).flatMap((item) =>
      item.kind === 'primitive'
        ? item.events
            .filter((e) => isWholeEnter(e) && Math.abs(e.beatEndSec - beat.endSec) < EPSILON_SEC)
            .flatMap((enter) => {
              const endSec = enter.sec + (enter.drawSec ?? ACTION_DURATION_SEC.enter);
              if (endSec <= shownUntil + EPSILON_SEC) return [];
              if (continued && !exitsBefore(item.events, enter.sec, shownUntil)) return [];
              return [warning(scene, i, item.key, enter, endSec, shownUntil)];
            })
        : [],
    );
  });
}

const isWholeEnter = (e: ElementEvent) => e.action === 'enter' && !eventParts(e.params);

function exitsBefore(events: readonly ElementEvent[], fromSec: number, untilSec: number): boolean {
  return events.some(
    (e) => e.action === 'exit' && !eventParts(e.params) && e.sec > fromSec && e.sec <= untilSec,
  );
}

function flat(items: readonly WorldItem[]): WorldItem[] {
  return items.flatMap((i) => [i, ...(i.kind === 'primitive' ? flat(i.children) : [])]);
}

function warning(
  scene: BeatScene,
  i: number,
  key: string,
  enter: ElementEvent,
  endSec: number,
  shownUntil: number,
): SpecError {
  const takes = endSec - enter.sec;
  return {
    path: toJsonPath(locate(scene, i, key)),
    code: 'draw_cut_short',
    message:
      `"${key}" enters at ${secs(enter.sec)} and takes ${secs(takes)} to appear, but its scene ` +
      `ends at ${secs(shownUntil)}, so it is cut off ${secs(endSec - shownUntil)} early. Anchor ` +
      'its enter earlier, or end the beat later (more narration after it).',
  };
}

/** The scene event that enters the element, else its pattern instance or element, else the scene. */
function locate(scene: BeatScene, i: number, key: string): Path {
  const instance = key.includes('/') ? key.slice(0, key.indexOf('/')) : undefined;
  const k = scene.events.findIndex(
    (e) => e.action === 'enter' && e.targets.some((t) => t === key || t === instance),
  );
  if (k >= 0) return ['scenes', i, 'events', k];
  const j = scene.patterns.findIndex((p) => p.id === instance);
  if (j >= 0) return ['scenes', i, 'patterns', j];
  const e = scene.elements.findIndex((el) => el.id === key);
  return e >= 0 ? ['scenes', i, 'elements', e] : ['scenes', i];
}

function secs(sec: number): string {
  return `${sec.toFixed(2)}s`;
}
