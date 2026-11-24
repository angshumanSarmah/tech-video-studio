import {
  effectiveTiming,
  narrationWords,
  resolveAnchorSec,
  type BeatScene,
  type EffectiveTiming,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { analyse } from '../layout/analyse.ts';
import { beatLayoutMode, LAYOUT_MODES } from '../layout/modes.ts';
import { minReadableScale } from '../layout/readable.ts';
import { specLayout } from '../layout/spec-layout.ts';
import { INNER_TARGET_ACTIONS } from '../patterns/types.ts';
import { elementState, type PartState } from '../primitives/element-state.ts';
import { beatWorld, sceneChain, type WorldItem } from '../scene/beat-world.ts';
import { getTheme, type Theme } from '../theme/index.ts';
import { sceneEndSec } from '../timing/frames.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { primitivePinHost, type PinHost } from './pin-hosts.ts';
import { paramLeaves, propLeaves } from './schema-leaves.ts';
import { sceneScopes, type ScopeEntry } from './scope.ts';
import { flattenWorld } from './settled.ts';

/**
 * What a board shows when a beat's scene leaves the screen (P1C.7): the Generator's ON SCREEN
 * list for the next beat of the board, and the `zoomFrom` choices for a semantic zoom after it.
 * Every element and pattern instance the board has declared so far, with its display text,
 * whether it is present or has exited, the reject and lock it still holds (whole and per part),
 * whether a held highlight is still on, the actions it takes and, for an instance, its inner ids;
 * plus the focus, the units on screen against the layout mode's capacity. Pure.
 */

export type HeldState = 'rejected' | 'locked';

export type BoardInner = {
  /** `<instance>/<id>`. */
  id: string;
  primitive: string;
  present: boolean;
  held: HeldState[];
  highlighted: boolean;
};

export type BoardEntry = {
  id: string;
  kind: 'primitive' | 'pattern';
  /** Primitive or pattern id. */
  type: string;
  /** The first screen text it shows (a title, label or text), if any. */
  text?: string;
  present: boolean;
  held: HeldState[];
  highlighted: boolean;
  /** Parts that still hold a reject or lock. */
  heldParts: { part: string; held: HeldState[] }[];
  /** Actions an event may use on it (an instance: the instance actions). */
  actions: readonly string[];
  /** Its parts and the actions they take (`params.parts`), when it has parts. */
  parts?: { ids: readonly string[]; actions: readonly string[] };
  /** Which pins it can host (`primitivePinHost`; a pattern instance: none). */
  pinHost: PinHost;
  /** A pattern instance's elements, which events may target with `innerActions` only. */
  inner?: BoardInner[];
  innerActions?: readonly string[];
};

export type BoardState = {
  /** The board's layout mode, its zones and how many units it holds. */
  mode: string;
  zones: readonly string[];
  maxUnits: number | undefined;
  /** Units on screen (layout units plus an overlay's children). */
  units: number;
  /** Ids the board focuses at that moment. */
  focus: string[];
  entries: BoardEntry[];
  /**
   * The board scale its chain is laid out at so far (1 = preferred size), and the lowest scale
   * at which its labels stay readable (`text_too_small` below it): the room a continuing beat
   * has for new elements, since every element of a chain keeps its place.
   */
  scale: number;
  readableScale: number;
};

const FPS = 30;

export type BoardStateOptions = { registries?: Registries; theme?: Theme };

/** The board of `beatId`'s chain as its scene leaves the screen. */
export function boardState(
  spec: RenderableVideoSpec,
  beatId: string,
  { registries = DEFAULT_REGISTRIES, theme = getTheme() }: BoardStateOptions = {},
): BoardState {
  const timing = effectiveTiming(spec);
  const chain = sceneChain(spec.scenes, beatId);
  const index = spec.scenes.findIndex((s) => s.beatId === beatId);
  const scope = sceneScopes(spec.scenes, registries)[index] ?? new Map<string, ScopeEntry>();
  const world = beatWorld(spec, timing, beatId, FPS, registries);
  const byKey = new Map(flattenWorld(world).map((item) => [item.key, item]));
  const sec = sceneEndSec(timing, beatId) - 1 / FPS;
  const stateOf = (key: string) => {
    const item = byKey.get(key);
    return item?.kind === 'primitive'
      ? elementState(item.events, Math.round(sec * FPS), FPS, item.focus)
      : undefined;
  };
  const entries = chain.flatMap((scene) => [
    ...scene.elements.map((e) => elementEntry(e, scope.get(e.id), stateOf(e.id), registries)),
    ...scene.patterns.map((p) => patternEntry(p, scope, byKey, stateOf, registries)),
  ]);
  const first = chain[0];
  const mode = first ? LAYOUT_MODES.get(beatLayoutMode(first, registries.patterns)) : undefined;
  const focus = focusAt(spec, timing, chain, sec);
  return {
    mode: mode?.id ?? '',
    zones: mode?.zones ?? [],
    maxUnits: mode?.maxUnits,
    units: mode ? unitsOnScreen(world, sec, mode, focus, theme) : 0,
    focus,
    entries,
    scale: specLayout(spec, theme, registries).beats.get(beatId)?.chain.board.scale ?? 1,
    readableScale: minReadableScale(theme),
  };
}

type State = ReturnType<typeof elementState> | undefined;

function heldOf(state: Pick<PartState, 'actions'> | undefined): HeldState[] {
  const actions = state?.actions ?? {};
  return [
    ...((actions.reject ?? 0) > 0 ? ['rejected' as const] : []),
    ...((actions.lock ?? 0) > 0 ? ['locked' as const] : []),
  ];
}

function elementEntry(
  element: BeatScene['elements'][number],
  entry: ScopeEntry | undefined,
  state: State,
  registries: Registries,
): BoardEntry {
  const definition = registries.primitives.get(element.primitive);
  const text = definition
    ? propLeaves(definition, element.props).find((l) => l.kind === 'text')?.value
    : undefined;
  const heldParts = Object.entries(state?.parts ?? {}).flatMap(([part, partState]) => {
    const held = heldOf(partState);
    return held.length > 0 ? [{ part, held }] : [];
  });
  return {
    id: element.id,
    kind: 'primitive',
    type: element.primitive,
    ...(typeof text === 'string' ? { text } : {}),
    present: (state?.presence ?? 0) > 0.5,
    held: heldOf(state),
    highlighted: (state?.highlight ?? 0) > 0,
    heldParts,
    actions: entry?.actions ?? [],
    ...(entry?.parts ? { parts: { ids: entry.parts.ids, actions: entry.parts.actions } } : {}),
    pinHost: primitivePinHost(definition),
  };
}

function patternEntry(
  pattern: BeatScene['patterns'][number],
  scope: ReadonlyMap<string, ScopeEntry>,
  byKey: ReadonlyMap<string, WorldItem>,
  stateOf: (key: string) => State,
  registries: Registries,
): BoardEntry {
  const entry = scope.get(pattern.id);
  const definition = registries.patterns.get(pattern.pattern);
  const text = definition
    ? paramLeaves(definition, pattern.params).find((l) => l.kind === 'text')?.value
    : undefined;
  const inner = (entry?.inner ?? []).map((id): BoardInner => {
    const key = `${pattern.id}/${id}`;
    const item = byKey.get(key);
    const state = stateOf(key);
    return {
      id: key,
      primitive: item?.kind === 'primitive' ? item.definition.id : '',
      present: (state?.presence ?? 0) > 0.5,
      held: heldOf(state),
      highlighted: (state?.highlight ?? 0) > 0,
    };
  });
  return {
    id: pattern.id,
    kind: 'pattern',
    type: pattern.pattern,
    ...(typeof text === 'string' ? { text } : {}),
    present: inner.some((i) => i.present),
    held: [],
    highlighted: inner.length > 0 && inner.every((i) => i.highlighted),
    heldParts: [],
    actions: entry?.actions ?? [],
    pinHost: 'none',
    inner,
    innerActions: INNER_TARGET_ACTIONS,
  };
}

/**
 * The ids the board focuses at `sec`: the latest beat focus in the chain, moved by any `focus`
 * event that has played by then.
 */
function focusAt(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  chain: readonly BeatScene[],
  sec: number,
): string[] {
  let focus: string[] = [];
  for (const scene of chain) {
    if (scene.focus.length > 0) focus = [...scene.focus];
    const beat = timing.beats.find((b) => b.beatId === scene.beatId);
    const words = narrationWords(
      spec.script.find((s) => s.beatId === scene.beatId)?.narration ?? '',
    );
    const moves = scene.events
      .filter((e) => e.action === 'focus')
      .map((e) => ({
        at: beat ? resolveAnchorSec(e.at, beat, words) : undefined,
        targets: e.targets,
      }))
      .filter((m): m is { at: number; targets: string[] } => m.at !== undefined && m.at <= sec)
      .sort((a, b) => a.at - b.at);
    const last = moves.at(-1);
    if (last) focus = [...last.targets];
  }
  return focus;
}

function unitsOnScreen(
  world: readonly WorldItem[],
  sec: number,
  mode: NonNullable<ReturnType<typeof LAYOUT_MODES.get>>,
  focus: readonly string[],
  theme: Theme,
): number {
  const present = (item: WorldItem) =>
    item.kind === 'primitive' && elementState(item.events, Math.round(sec * FPS), FPS).presence > 0;
  const shown = world.filter(present);
  const children = shown.flatMap((item) =>
    item.kind === 'primitive' && item.layer === 'overlay' ? item.children.filter(present) : [],
  );
  return analyse(shown, mode, new Set(focus), theme).units.length + children.length;
}
