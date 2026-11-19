import {
  effectiveTiming,
  toJsonPath,
  type BeatScene,
  type EffectiveTiming,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { DEFAULT_REGISTRIES, type Registries } from '../catalog/registries.ts';
import { beatHasHeadline } from '../hud/hud-state.ts';
import { lineHeightPx } from '../primitives/measure.ts';
import { beatWorld } from '../scene/beat-world.ts';
import { footnoteRect } from '../scene/source-footnote.ts';
import type { Rect, Theme } from '../theme/index.ts';
import { beatCamera, visibleDuring } from './camera.ts';
import type { Transform } from './fit.ts';
import { formatAreas, type FormatAreas } from './format.ts';
import { layout } from './layout.ts';
import { beatLayoutMode } from './modes.ts';
import type { BoardLayout, LayoutFrame, LayoutWarning } from './types.ts';

/**
 * A whole spec laid out: one board per `continuesPrevious` chain (so continuing beats keep every
 * position), and a camera per beat that frames what that beat shows. Computed once per spec
 * object and theme (memoised), never per frame. Pure and deterministic.
 */

export type ChainLayout = {
  /** Index of the chain's first scene in `spec.scenes`. */
  sceneIndex: number;
  beatIds: readonly string[];
  board: BoardLayout;
  /** The beat source line's rect, reserved for the whole chain when any beat has a source. */
  footnote: Rect | null;
};

export type BeatLayout = { beatId: string; chain: ChainLayout; camera: Transform };

export type SpecLayout = {
  areas: FormatAreas;
  chains: readonly ChainLayout[];
  beats: ReadonlyMap<string, BeatLayout>;
};

/** Any fps works: the layout reads event seconds, not frames. */
const LAYOUT_FPS = 30;

const cache = new WeakMap<RenderableVideoSpec, Map<string, SpecLayout>>();

export function specLayout(
  spec: RenderableVideoSpec,
  theme: Theme,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecLayout {
  if (registries !== DEFAULT_REGISTRIES) return computeSpecLayout(spec, theme, registries);
  const byTheme = cache.get(spec) ?? new Map<string, SpecLayout>();
  cache.set(spec, byTheme);
  const cached = byTheme.get(theme.id);
  if (cached) return cached;
  const computed = computeSpecLayout(spec, theme, registries);
  byTheme.set(theme.id, computed);
  return computed;
}

function computeSpecLayout(
  spec: RenderableVideoSpec,
  theme: Theme,
  registries: Registries,
): SpecLayout {
  const areas = formatAreas(theme, spec.meta.format);
  const timing = effectiveTiming(spec);
  const chains = sceneChains(spec.scenes).map((c) =>
    chainLayout(spec, c, { theme, timing, areas, registries }),
  );
  const beats = new Map<string, BeatLayout>();
  for (const chain of chains) {
    for (const beatId of chain.beatIds) {
      const camera = cameraFor(spec, chain, beatId, { theme, timing, areas, registries });
      beats.set(beatId, { beatId, chain, camera });
    }
  }
  return { areas, chains, beats };
}

type Ctx = { theme: Theme; timing: EffectiveTiming; areas: FormatAreas; registries: Registries };

type Chain = { sceneIndex: number; scenes: readonly BeatScene[] };

/** Scenes grouped into chains: each starts at a scene that does not continue the previous one. */
export function sceneChains(scenes: readonly BeatScene[]): Chain[] {
  const chains: Chain[] = [];
  scenes.forEach((scene, i) => {
    const last = chains.at(-1);
    if (last && scene.continuesPrevious) last.scenes = [...last.scenes, scene];
    else chains.push({ sceneIndex: i, scenes: [scene] });
  });
  return chains;
}

function chainLayout(spec: RenderableVideoSpec, chain: Chain, ctx: Ctx): ChainLayout {
  const { theme, timing, areas, registries } = ctx;
  const [first] = chain.scenes;
  const lastBeat = chain.scenes.at(-1)?.beatId ?? '';
  const beatIds = chain.scenes.map((s) => s.beatId);
  const items = beatWorld(spec, timing, lastBeat, LAYOUT_FPS, registries);
  const mode = first ? beatLayoutMode(first, registries.patterns) : '';
  const focus = [...new Set(chain.scenes.flatMap((s) => s.focus))];
  const { frame, footnote } = chainFrame(spec, beatIds, theme, areas);
  const board = layout({ items, mode, focus }, theme, frame);
  const ignored = chain.scenes
    .slice(1)
    .filter((s) => s.layoutMode !== undefined && s.layoutMode !== board.mode)
    .map((s): LayoutWarning => modeIgnored(s, board.mode));
  return {
    sceneIndex: chain.sceneIndex,
    beatIds,
    board: { ...board, warnings: [...board.warnings, ...ignored] },
    footnote,
  };
}

/**
 * The chain's board frame: the format's board (smaller when any beat of the chain shows a
 * headline), less the footnote line when any beat has a source.
 */
function chainFrame(
  spec: RenderableVideoSpec,
  beatIds: readonly string[],
  theme: Theme,
  areas: FormatAreas,
): { frame: LayoutFrame; footnote: Rect | null } {
  const headline = beatIds.some((id) => beatHasHeadline(spec, id));
  const rect = headline ? areas.boardWithHeadline : areas.board;
  const sourced = spec.script.some((s) => beatIds.includes(s.beatId) && s.source !== undefined);
  if (!sourced) return { frame: { rect, avoidZones: areas.avoidZones }, footnote: null };
  const line = lineHeightPx(theme, 'footnote');
  const footnote = footnoteRect(rect, areas.avoidZones, line, theme.space.md);
  const board = { ...rect, height: rect.height - line - theme.space.sm };
  return { frame: { rect: board, avoidZones: areas.avoidZones }, footnote };
}

function cameraFor(spec: RenderableVideoSpec, chain: ChainLayout, beatId: string, ctx: Ctx) {
  const { theme, timing, registries } = ctx;
  const beat = timing.beats.find((b) => b.beatId === beatId);
  const world = beatWorld(spec, timing, beatId, LAYOUT_FPS, registries);
  const visible = new Set(
    world
      .filter(
        (item) =>
          item.kind === 'error' || !beat || visibleDuring(item.events, beat.startSec, beat.endSec),
      )
      .map((item) => item.key),
  );
  const scene = spec.scenes.find((s) => s.beatId === beatId);
  const focus = (scene?.focus ?? []).flatMap((id) =>
    [...visible].filter((key) => key === id || key.startsWith(`${id}/`)),
  );
  return beatCamera({
    items: chain.board.items,
    visible,
    focus,
    frame: chain.board.frame,
    avoidZones: ctx.areas.avoidZones,
    margin: theme.space.md,
  });
}

function modeIgnored(scene: BeatScene, mode: string): LayoutWarning {
  return {
    code: 'layout_mode_ignored',
    message: `Beat "${scene.beatId}" continues the previous beat, which is laid out as ${mode}; its own layoutMode "${scene.layoutMode ?? ''}" is ignored.`,
    keys: [],
  };
}

/**
 * Layout warnings for the Curator, in the spec issue shape. Each points at the scene that starts
 * the chain (or the continuing scene whose mode was ignored).
 */
export function specLayoutWarnings(
  spec: RenderableVideoSpec,
  theme: Theme,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  return specLayout(spec, theme, registries).chains.flatMap((chain) =>
    chain.board.warnings.map((w) => ({
      path: toJsonPath(['scenes', chain.sceneIndex]),
      code: w.code,
      message: w.keys.length > 0 ? `${w.message} (${w.keys.join(', ')})` : w.message,
    })),
  );
}
