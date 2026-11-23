import {
  effectiveTiming,
  narrationWords,
  resolveAnchorSec,
  toJsonPath,
  type BeatScene,
  type EffectiveTiming,
  type RenderableVideoSpec,
  type SpecError,
} from '@explainer-studio/shared';
import { DEFAULT_REGISTRIES, type Registries } from '../catalog/registries.ts';
import { beatHasHeadline } from '../hud/hud-state.ts';
import { beatWorld } from '../scene/beat-world.ts';
import { footnoteLine } from '../scene/source-footnote.ts';
import type { Rect, Theme } from '../theme/index.ts';
import { CAMERA_EASE_SEC, ZOOM_PUSH_SEC } from '../events/presets.ts';
import { beatCamera, visibleDuring } from './camera.ts';
import { zoomCamera, type CameraKey } from './camera-track.ts';
import type { Transform } from './fit.ts';
import { union } from './rect.ts';
import { formatAreas, type FormatAreas } from './format.ts';
import { layout } from './layout.ts';
import { textTruncationWarnings } from './text-fit.ts';
import { beatLayoutMode } from './modes.ts';
import type { BoardLayout, LayoutFrame, LayoutWarning } from './types.ts';

/**
 * A whole spec laid out: one board per `continuesPrevious` chain (so continuing beats keep every
 * position), and a camera track per chain (`camera-track.ts`): each beat frames what it shows,
 * biased to its focus, and reframes at each `focus` event; a semantic zoom (`zoomFrom`) pushes
 * the previous chain's camera into its element. Computed once per spec object and theme
 * (memoised), never per frame. Pure and deterministic.
 */

export type ChainLayout = {
  /** Index of the chain's first scene in `spec.scenes`. */
  sceneIndex: number;
  beatIds: readonly string[];
  board: BoardLayout;
  /** The beat source line's rect, reserved for the whole chain when any beat has a source. */
  footnote: Rect | null;
  /** The chain's camera keys in time order (read with `cameraAt`). */
  cameras: readonly CameraKey[];
};

/** `camera`: the beat's own framing at its start (where its first camera key eases to). */
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
  const ctx = { theme, timing, areas, registries };
  const boards = sceneChains(spec.scenes).map((c) => chainLayout(spec, c, ctx));
  const starts = new Map<string, Transform>();
  const tracks = boards.map((chain) => chainCameras(spec, chain, ctx, starts));
  addZoomPushes(spec, boards, tracks, timing);
  const chains = boards.map((chain, i) => ({ ...chain, cameras: tracks[i] ?? [] }));
  const beats = new Map<string, BeatLayout>();
  for (const chain of chains) {
    for (const beatId of chain.beatIds) {
      beats.set(beatId, { beatId, chain, camera: starts.get(beatId) ?? IDENTITY_CAMERA });
    }
  }
  return { areas, chains, beats };
}

const IDENTITY_CAMERA: Transform = { scale: 1, dx: 0, dy: 0 };

type Board = Omit<ChainLayout, 'cameras'>;

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

function chainLayout(spec: RenderableVideoSpec, chain: Chain, ctx: Ctx): Board {
  const { theme, timing, areas, registries } = ctx;
  const [first] = chain.scenes;
  const lastBeat = chain.scenes.at(-1)?.beatId ?? '';
  const beatIds = chain.scenes.map((s) => s.beatId);
  const items = beatWorld(spec, timing, lastBeat, LAYOUT_FPS, registries, undefined, 'chain');
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
  const footnote = footnoteLine(theme, rect, areas.avoidZones);
  const board = { ...rect, height: rect.height - footnote.height - theme.space.sm };
  return { frame: { rect: board, avoidZones: areas.avoidZones }, footnote };
}

/**
 * A chain's camera keys: each beat's framing at its start (the first settled, later ones easing
 * from the previous beat), then a reframing at each of its `focus` events. `starts` collects each
 * beat's own start framing.
 */
function chainCameras(
  spec: RenderableVideoSpec,
  chain: Board,
  ctx: Ctx,
  starts: Map<string, Transform>,
): CameraKey[] {
  return chain.beatIds.flatMap((beatId, j) => {
    const beat = ctx.timing.beats.find((b) => b.beatId === beatId);
    const scene = spec.scenes.find((s) => s.beatId === beatId);
    const visible = visibleKeys(spec, beatId, ctx);
    const frame = (focus: readonly string[]) => cameraFor(chain, visible, focus, ctx);
    const start = frame(scene?.focus ?? []);
    starts.set(beatId, start);
    const first = {
      sec: beat?.startSec ?? 0,
      camera: start,
      durationSec: j === 0 ? 0 : CAMERA_EASE_SEC,
    };
    return [first, ...focusEventCameras(spec, beatId, ctx, frame)];
  });
}

/** One camera key per `focus` event of the beat, framed for its targets. */
function focusEventCameras(
  spec: RenderableVideoSpec,
  beatId: string,
  ctx: Ctx,
  frame: (focus: readonly string[]) => Transform,
): CameraKey[] {
  const beat = ctx.timing.beats.find((b) => b.beatId === beatId);
  const scene = spec.scenes.find((s) => s.beatId === beatId);
  if (!beat || !scene) return [];
  const words = narrationWords(spec.script.find((s) => s.beatId === beatId)?.narration ?? '');
  return scene.events
    .flatMap((event) => {
      if (event.action !== 'focus') return [];
      const sec = resolveAnchorSec(event.at, beat, words);
      if (sec === undefined) return [];
      return [{ sec, camera: frame(event.targets), durationSec: CAMERA_EASE_SEC }];
    })
    .sort((a, b) => a.sec - b.sec);
}

/** Keys of the items a beat shows at some point (error items always count). */
function visibleKeys(spec: RenderableVideoSpec, beatId: string, ctx: Ctx): Set<string> {
  const beat = ctx.timing.beats.find((b) => b.beatId === beatId);
  const world = beatWorld(spec, ctx.timing, beatId, LAYOUT_FPS, ctx.registries);
  return new Set(
    world
      .filter(
        (item) =>
          item.kind === 'error' || !beat || visibleDuring(item.events, beat.startSec, beat.endSec),
      )
      .map((item) => item.key),
  );
}

function cameraFor(
  chain: Board,
  visible: ReadonlySet<string>,
  focusIds: readonly string[],
  ctx: Ctx,
): Transform {
  const focus = focusIds.flatMap((id) =>
    [...visible].filter((key) => key === id || key.startsWith(`${id}/`)),
  );
  return beatCamera({
    items: chain.board.items,
    visible,
    focus,
    frame: chain.board.frame,
    avoidZones: ctx.areas.avoidZones,
    margin: ctx.theme.space.md,
  });
}

/**
 * Semantic zoom: before a beat that zooms from an element of the previous board, that board's
 * camera pushes into the element over the last `ZOOM_PUSH_SEC` before the beat starts.
 */
function addZoomPushes(
  spec: RenderableVideoSpec,
  boards: readonly Board[],
  tracks: CameraKey[][],
  timing: EffectiveTiming,
): void {
  spec.scenes.forEach((scene, i) => {
    const from = scene.zoomFrom;
    if (!from || i === 0 || scene.continuesPrevious || scene.transitionIn !== 'zoom-in') return;
    const previous = spec.scenes[i - 1]?.beatId;
    const c = boards.findIndex((b) => previous !== undefined && b.beatIds.includes(previous));
    const board = boards[c];
    const start = timing.beats.find((b) => b.beatId === scene.beatId)?.startSec;
    const target = board ? zoomTarget(board, from) : undefined;
    if (!board || !target || start === undefined) return;
    const push: CameraKey = {
      sec: Math.max(0, start - ZOOM_PUSH_SEC),
      camera: zoomCamera(target, board.board.frame),
      durationSec: Math.min(ZOOM_PUSH_SEC, start),
      push: true,
    };
    tracks[c] = [...(tracks[c] ?? []), push].sort((a, b) => a.sec - b.sec);
  });
}

/** The rect of an element (or every element of a pattern instance) on a placed board. */
function zoomTarget(board: Board, id: string): Rect | undefined {
  const rects = board.board.items
    .filter((item) => item.key === id || item.key.startsWith(`${id}/`))
    .map((item) => item.rect);
  return union(rects);
}

function modeIgnored(scene: BeatScene, mode: string): LayoutWarning {
  return {
    code: 'layout_mode_ignored',
    message: `Beat "${scene.beatId}" continues the previous beat, which is laid out as ${mode}; its own layoutMode "${scene.layoutMode ?? ''}" is ignored.`,
    keys: [],
  };
}

/**
 * Layout warnings for the Curator, in the spec issue shape. Board warnings point at the scene
 * that starts the chain (or the continuing scene whose mode was ignored); `text_truncated` points
 * at the text itself (`text-fit.ts`).
 */
export function specLayoutWarnings(
  spec: RenderableVideoSpec,
  theme: Theme,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const result = specLayout(spec, theme, registries);
  const board = result.chains.flatMap((chain) =>
    chain.board.warnings.map((w) => ({
      path: toJsonPath(['scenes', chain.sceneIndex]),
      code: w.code,
      message: w.keys.length > 0 ? `${w.message} (${w.keys.join(', ')})` : w.message,
    })),
  );
  return [...board, ...textTruncationWarnings(spec, result, theme, registries)];
}
