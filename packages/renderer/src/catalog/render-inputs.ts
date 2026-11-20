import {
  effectiveTiming,
  type BeatScene,
  type EffectiveTiming,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { sceneChains } from '../layout/spec-layout.ts';

/**
 * Everything in a spec that can change the frames of one beat cut from the timeline
 * (`BeatFromSpec`), as plain JSON for a cache key (the worker hashes it; pure, React-free).
 *
 * It errs towards over-invalidating, never towards a stale clip. It starts from the whole spec
 * and removes only the per-beat content of beats outside this beat's `continuesPrevious` chain,
 * so fields added to the spec later are included automatically:
 * - the whole chain (its scenes, script, story beats and timed words): continuing beats share one
 *   placement and camera track over all their elements, including later beats in the chain;
 * - every beat's id, chapter and start/end (from the effective timing, so estimated timing is
 *   covered too): the HUD reads chapters, the step tracker and the story clock across beats;
 * - the next scene's `transitionIn` and `zoomFrom`: a semantic zoom pushes this beat's camera.
 *
 * The `timing.events` cache is dropped: the renderer never reads it.
 */
export type BeatRenderInputs = {
  beatId: string;
  chain: string[];
  spec: unknown;
  timing: unknown;
  next: { transitionIn: string; zoomFrom: string | null } | null;
};

export function beatRenderInputs(spec: RenderableVideoSpec, beatId: string): BeatRenderInputs {
  const chain = chainOf(spec.scenes, beatId);
  const inChain = new Set(chain);
  const timing = effectiveTiming(spec);
  return {
    beatId,
    chain,
    spec: {
      ...spec,
      timing: undefined,
      script: spec.script.map((s) => (inChain.has(s.beatId) ? s : { beatId: s.beatId })),
      scenes: spec.scenes.map((s) =>
        inChain.has(s.beatId) ? s : { beatId: s.beatId, continuesPrevious: s.continuesPrevious },
      ),
      story: {
        ...spec.story,
        beats: spec.story.beats.map((b) =>
          inChain.has(b.id) ? b : { id: b.id, chapterId: b.chapterId },
        ),
      },
    },
    timing: timingSlice(timing, inChain),
    next: nextTransition(spec.scenes, chain),
  };
}

/** Beat ids of the `continuesPrevious` chain that holds `beatId`; empty for an unknown beat. */
export function chainOf(scenes: readonly BeatScene[], beatId: string): string[] {
  const chain = sceneChains(scenes).find((c) => c.scenes.some((s) => s.beatId === beatId));
  return chain ? chain.scenes.map((s) => s.beatId) : [];
}

function timingSlice(timing: EffectiveTiming, inChain: ReadonlySet<string>) {
  return {
    estimated: timing.estimated,
    endSec: timing.endSec,
    beats: timing.beats.map((b) =>
      inChain.has(b.beatId) ? b : { beatId: b.beatId, startSec: b.startSec, endSec: b.endSec },
    ),
  };
}

function nextTransition(scenes: readonly BeatScene[], chain: readonly string[]) {
  const lastIndex = scenes.findIndex((s) => s.beatId === chain.at(-1));
  const next = lastIndex < 0 ? undefined : scenes[lastIndex + 1];
  return next ? { transitionIn: next.transitionIn, zoomFrom: next.zoomFrom ?? null } : null;
}
