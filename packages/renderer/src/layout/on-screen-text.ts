import {
  effectiveTiming,
  toJsonPath,
  type EffectiveTiming,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { DEFAULT_REGISTRIES, type Registries } from '../catalog/registries.ts';
import type { Theme } from '../theme/index.ts';
import { sceneEndSec } from '../timing/frames.ts';
import type { CameraKey } from './camera-track.ts';
import { MIN_TEXT_PX, minReadableScale } from './readable.ts';
import { specLayout, type ChainLayout } from './spec-layout.ts';

/**
 * Text size as the viewer sees it (P1C.8, "option B"). The layout places a `continuesPrevious`
 * chain once, at one board scale for everything the chain ever shows, and warns
 * `text_too_small` when that scale is below the readable one. Each beat's camera then frames only
 * what that beat shows, zooming in (never out: zoom ≥ 1), so a long chain can read fine beat by
 * beat. This measures each beat of such a chain at board scale × its camera zoom, taking the
 * smallest zoom the beat holds (its start framing and each `focus` reframing; a semantic-zoom push
 * is momentary and left out), and warns `text_too_small_on_screen` on the beats still below
 * `MIN_TEXT_PX`. The Curator reports this in place of the chain-level warning. Pure.
 */

export const TEXT_TOO_SMALL_ON_SCREEN = 'text_too_small_on_screen';

const EPSILON = 1e-6;

export function onScreenTextWarnings(
  spec: RenderableVideoSpec,
  theme: Theme,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const timing = effectiveTiming(spec);
  const min = minReadableScale(theme);
  return specLayout(spec, theme, registries).chains.flatMap((chain) => {
    const tooSmall = chain.board.warnings.find((w) => w.code === 'text_too_small');
    if (!tooSmall || chain.board.scale >= min - EPSILON) return [];
    return chain.beatIds.flatMap((beatId, k) => {
      const zoom = heldZoom(chain.cameras, timing, beatId);
      if (chain.board.scale * zoom >= min - EPSILON) return [];
      return [beatWarning(chain, k, zoom, theme, tooSmall.message)];
    });
  });
}

/** The smallest zoom the beat's camera settles on while the beat is on screen. */
function heldZoom(keys: readonly CameraKey[], timing: EffectiveTiming, beatId: string): number {
  const start = timing.beats.find((b) => b.beatId === beatId)?.startSec ?? 0;
  const end = sceneEndSec(timing, beatId);
  const held = keys.filter((k) => !k.push && k.sec >= start - EPSILON && k.sec < end - EPSILON);
  return held.length > 0 ? Math.min(...held.map((k) => k.camera.scale)) : 1;
}

function beatWarning(
  chain: ChainLayout,
  k: number,
  zoom: number,
  theme: Theme,
  boardMessage: string,
): SpecError {
  const shown = chain.board.scale * zoom;
  const px = (theme.text.label.size * shown).toFixed(1);
  const pct = Math.round(chain.board.scale * 100);
  const board =
    chain.beatIds.length > 1
      ? ` The board is laid out once for beats ${chain.beatIds.join(', ')}: everything they ` +
        'show shares one scale, and this beat frames too much of it.'
      : '';
  return {
    path: toJsonPath(['scenes', chain.sceneIndex + k]),
    code: TEXT_TOO_SMALL_ON_SCREEN,
    message:
      `On screen in this beat labels are ${px}px (board at ${pct}%, camera zoom ` +
      `×${zoom.toFixed(2)}); readable needs ${MIN_TEXT_PX}px.${board} ${roomAdvice(boardMessage)}`,
  };
}

/** The layout warning's advice (what takes the room), without its board-scale sentence. */
function roomAdvice(message: string): string {
  return message.replace(/^The board only fits at [^)]*\)\.\s*/, '');
}
