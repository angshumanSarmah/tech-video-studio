import {
  effectiveTiming,
  toJsonPath,
  type BeatScene,
  type EffectiveTiming,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { eventParts } from '../primitives/parts.ts';
import { elementState } from '../primitives/element-state.ts';
import { beatWorld, sceneChain, type WorldItem } from '../scene/beat-world.ts';
import { sceneEndSec } from '../timing/frames.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Colour meaning on boards (P1C.8; Generator prompt: "problem = failure or rejection, ok =
 * success, focus = the thing to watch"). Two narrow rules, warnings the Curator reports as
 * advisory; the review judges colour against the narration.
 * - `focus_colour_off_focus`: an element a beat adds in the focus colour that is never in focus
 *   while that beat is on screen (dimmed the whole time): two things say "watch me". An element
 *   pinned to or inside one already reported is left out (it follows its host).
 * - `ok_element_rejected`: a whole-element `reject` on an element drawn `ok`: the colour said it
 *   works before the story says it fails.
 * Pure.
 */

const FPS = 30;

/** How often the focus check samples a beat (seconds). */
const SAMPLE_SEC = 0.1;

type Props = Record<string, unknown>;

export function colourWarnings(
  spec: RenderableVideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const timing = effectiveTiming(spec);
  return spec.scenes.flatMap((scene, i) => [
    ...focusColourOffFocus(spec, timing, scene, i, registries),
    ...okElementRejected(spec, scene, i),
  ]);
}

/** Props in a semantic colour: `semantic`, and a transition's `fromSemantic` / `toSemantic`. */
function hasColour(props: unknown, semantic: string): boolean {
  if (typeof props !== 'object' || props === null) return false;
  return Object.entries(props as Props).some(
    ([key, value]) => /semantic$/i.test(key) && value === semantic,
  );
}

function focusColourOffFocus(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  scene: BeatScene,
  i: number,
  registries: Registries,
): SpecError[] {
  const world = new Map(
    beatWorld(spec, timing, scene.beatId, FPS, registries).map((item) => [item.key, item]),
  );
  const start = timing.beats.find((b) => b.beatId === scene.beatId)?.startSec ?? 0;
  const end = sceneEndSec(timing, scene.beatId);
  const reported = new Set<string>();
  return scene.elements.flatMap((element, j) => {
    const item = world.get(element.id);
    if (item?.kind !== 'primitive' || !hasColour(item.props, 'focus')) return [];
    if (hostsOf(item).some((host) => reported.has(host))) return [];
    if (everInFocus(item, start, end)) return [];
    reported.add(element.id);
    return [
      {
        path: toJsonPath(['scenes', i, 'elements', j]),
        code: 'focus_colour_off_focus',
        message:
          `"${element.id}" is drawn in the focus colour but is never the focus in this beat ` +
          `(${focusOf(scene)}), so it competes with what the viewer should watch. Give it ` +
          'another semantic (concept, neutral), or move the focus to it with a `focus` event on ' +
          'the word that names it.',
      },
    ];
  });
}

/** What an element is pinned to or drawn inside: it shares that element's focus. */
function hostsOf(item: Extract<WorldItem, { kind: 'primitive' }>): string[] {
  const refs = item.definition.elementRefs?.(item.props) ?? [];
  return refs.filter((ref) => ref.pin !== undefined).map((ref) => ref.id);
}

/** Present and not dimmed at some moment of `[start, end)`. */
function everInFocus(
  item: Extract<WorldItem, { kind: 'primitive' }>,
  start: number,
  end: number,
): boolean {
  for (let sec = start; sec < end; sec += SAMPLE_SEC) {
    const state = elementState(item.events, Math.round(sec * FPS), FPS, item.focus);
    if (state.presence > 0.5 && state.dimmed < 0.5) return true;
  }
  return false;
}

function focusOf(scene: BeatScene): string {
  const ids = [
    ...scene.focus,
    ...scene.events.filter((e) => e.action === 'focus').flatMap((e) => e.targets),
  ];
  return ids.length > 0 ? `its focus is ${[...new Set(ids)].join(', ')}` : 'it sets no focus';
}

function okElementRejected(spec: RenderableVideoSpec, scene: BeatScene, i: number): SpecError[] {
  const declared = new Map(
    sceneChain(spec.scenes, scene.beatId).flatMap((s) => s.elements.map((e) => [e.id, e])),
  );
  return scene.events.flatMap((event, e) => {
    if (event.action !== 'reject' || eventParts(event.params)) return [];
    const ok = event.targets.filter((id) => hasColour(declared.get(id)?.props, 'ok'));
    return ok.map((id) => ({
      path: toJsonPath(['scenes', i, 'events', e]),
      code: 'ok_element_rejected',
      message:
        `"${id}" is drawn ok (success) and rejected here, so its colour says it works before ` +
        'the story says it fails. Draw it neutral until it fails, or reject what actually fails.',
    }));
  });
}
