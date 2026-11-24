import {
  anchorWordIndex,
  effectiveTiming,
  narrationWords,
  normalizeWord,
  toJsonPath,
  type BeatScene,
  type EventAnchor,
  type RenderableVideoSpec,
  type SceneEvent,
} from '@explainer-studio/shared';
import { beatLayoutMode } from '../layout/modes.ts';
import { eventParts } from '../primitives/parts.ts';
import { beatWorld, sceneChain } from '../scene/beat-world.ts';
import { getTheme, type Theme } from '../theme/index.ts';
import { boardState, type BoardEntry, type HeldState } from './board-state.ts';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import { paramLeaves, propLeaves, type Leaf } from './schema-leaves.ts';

/**
 * A beat's board as words, for a reader who cannot see the video (P1C.8: the Curator's review).
 * Everything on the beat's board: what earlier beats of the board left on screen, then what this
 * beat adds; for each, its type, its screen texts and drawn numbers (`schema-leaves.ts`), its
 * colour meanings, icons and element refs (a pin, a connector's ends), a pattern's anchors and
 * inner elements, this beat's events on it with the narration word each happens on, and its
 * state as the beat leaves the screen. Plus the focus over the beat, the layout mode and the
 * transition. Generic over the registries: a new primitive or pattern needs no edit here. Pure.
 */

/** Where an event happens: a narration word (index, as written), or a beat edge. */
export type AnchorDescription =
  | { kind: 'word'; index: number; word: string }
  | { kind: 'edge'; edge: 'start' | 'end'; offsetSec: number }
  | { kind: 'unresolved' };

export type EventDescription = {
  action: string;
  at: AnchorDescription;
  /** The event's own target when it acts on one inner element (`<instance>/<id>`). */
  target?: string;
  /** Parts it acts on (`params.parts`), and whether it holds or scans. */
  parts?: readonly string[];
  hold?: boolean;
  scan?: boolean;
};

export type KeyedValue<T> = { key: string; value: T };

export type BoardItemDescription = {
  id: string;
  kind: 'element' | 'pattern';
  /** Primitive or pattern id. */
  type: string;
  /** Declared by this beat (else an earlier beat of the board left it on screen). */
  added: boolean;
  texts: KeyedValue<string>[];
  numbers: KeyedValue<number>[];
  /** `semantic`, `fromSemantic`, … wherever they sit in the props. */
  colours: KeyedValue<string>[];
  icons: KeyedValue<string>[];
  /** Other elements it points to: a pin (with its side), a connector's ends, a container's children. */
  refs: { key: string; id: string; side?: string }[];
  /** A pattern instance's narration anchors (`params.at`). */
  anchors: { name: string; at: AnchorDescription }[];
  /** A pattern instance's elements (`<instance>/<id>`) with their screen texts. */
  inner: { id: string; type: string; texts: string[] }[];
  /** This beat's events on it (or on one of its inner elements). */
  events: EventDescription[];
  /** As the beat leaves the screen. */
  end: { present: boolean; held: readonly HeldState[]; highlighted: boolean };
};

export type BoardDescription = {
  beatId: string;
  /** The beat whose board this one continues (`continuesPrevious`), if any. */
  continues?: string;
  layoutMode: string;
  transitionIn?: string;
  zoomFrom?: string;
  /** The focus at the beat's start, then each `focus` event. */
  focus: { ids: readonly string[]; at: AnchorDescription | 'start' }[];
  items: BoardItemDescription[];
};

export type BoardDescriptionOptions = { registries?: Registries; theme?: Theme };

export function describeBoard(
  spec: RenderableVideoSpec,
  beatId: string,
  { registries = DEFAULT_REGISTRIES, theme = getTheme() }: BoardDescriptionOptions = {},
): BoardDescription {
  const chain = sceneChain(spec.scenes, beatId);
  const scene = chain.at(-1);
  if (!scene) throw new Error(`No scene for beat "${beatId}".`);
  const words = wordsOf(spec, beatId);
  const previous = chain.at(-2);
  const before = previous
    ? new Map(
        boardState(spec, previous.beatId, { registries, theme }).entries.map((e) => [e.id, e]),
      )
    : new Map<string, BoardEntry>();
  const after = new Map(
    boardState(spec, beatId, { registries, theme }).entries.map((e) => [e.id, e]),
  );
  const inner = innerTexts(spec, beatId, registries);
  const ctx: ItemContext = { scene, words, after, inner, registries };
  const kept = chain
    .slice(0, -1)
    .flatMap((s) => itemsOf(s, false, ctx))
    .filter((item) => before.get(item.id)?.present ?? true);
  const first = chain[0] ?? scene;
  return {
    beatId,
    ...(previous ? { continues: previous.beatId } : {}),
    layoutMode: beatLayoutMode(first, registries.patterns),
    ...(scene.continuesPrevious ? {} : { transitionIn: scene.transitionIn }),
    ...(scene.zoomFrom ? { zoomFrom: scene.zoomFrom } : {}),
    focus: focusOf(scene, words),
    items: [...kept, ...itemsOf(scene, true, ctx)],
  };
}

type Words = { normalized: string[]; written: string[] };

type ItemContext = {
  scene: BeatScene;
  words: Words;
  after: ReadonlyMap<string, BoardEntry>;
  inner: ReadonlyMap<string, { type: string; texts: string[] }>;
  registries: Registries;
};

function wordsOf(spec: RenderableVideoSpec, beatId: string): Words {
  const narration = spec.script.find((s) => s.beatId === beatId)?.narration ?? '';
  return {
    normalized: narrationWords(narration),
    written: narration.split(/\s+/).filter((t) => normalizeWord(t).length > 0),
  };
}

export function describeAnchor(anchor: EventAnchor, words: Words): AnchorDescription {
  if (anchor.type === 'beat') {
    return { kind: 'edge', edge: anchor.edge, offsetSec: anchor.offsetSec };
  }
  const index = anchorWordIndex(anchor, words.normalized);
  const word = index === undefined ? undefined : words.written[index];
  return index === undefined || word === undefined
    ? { kind: 'unresolved' }
    : { kind: 'word', index, word };
}

function itemsOf(scene: BeatScene, added: boolean, ctx: ItemContext): BoardItemDescription[] {
  const elements = scene.elements.map((element) => {
    const definition = ctx.registries.primitives.get(element.primitive);
    const leaves = definition ? propLeaves(definition, element.props) : [];
    const refs = definition?.elementRefs?.(element.props) ?? [];
    return item(ctx, element.id, 'element', element.primitive, added, leaves, element.props, {
      refs: refs.map((r) => ({
        key: pathText(r.path),
        id: r.id,
        ...(r.pin !== undefined ? { side: r.pin } : {}),
      })),
    });
  });
  const patterns = scene.patterns.map((pattern) => {
    const definition = ctx.registries.patterns.get(pattern.pattern);
    const leaves = definition ? paramLeaves(definition, pattern.params) : [];
    const at = (pattern.params as { at?: Record<string, EventAnchor> }).at ?? {};
    return item(ctx, pattern.id, 'pattern', pattern.pattern, added, leaves, pattern.params, {
      anchors: Object.entries(at).map(([name, anchor]) => ({
        name,
        at: describeAnchor(anchor, ctx.words),
      })),
      inner: [...ctx.inner.entries()]
        .filter(([id]) => id.startsWith(`${pattern.id}/`))
        .map(([id, value]) => ({ id, ...value })),
    });
  });
  return [...elements, ...patterns];
}

function item(
  ctx: ItemContext,
  id: string,
  kind: BoardItemDescription['kind'],
  type: string,
  added: boolean,
  leaves: readonly Leaf[],
  props: unknown,
  extra: Partial<Pick<BoardItemDescription, 'refs' | 'anchors' | 'inner'>>,
): BoardItemDescription {
  const end = ctx.after.get(id);
  return {
    id,
    kind,
    type,
    added,
    texts: leaves.flatMap((l) =>
      l.kind === 'text' ? [{ key: pathText(l.path), value: l.value }] : [],
    ),
    numbers: leaves.flatMap((l) =>
      l.kind === 'number' ? [{ key: pathText(l.path), value: l.value }] : [],
    ),
    colours: colours(props),
    icons: leaves.flatMap((l) =>
      l.kind === 'asset' ? [{ key: pathText(l.path), value: l.value }] : [],
    ),
    refs: extra.refs ?? [],
    anchors: extra.anchors ?? [],
    inner: extra.inner ?? [],
    events: eventsOn(id, ctx),
    end: {
      present: end?.present ?? true,
      held: end?.held ?? [],
      highlighted: end?.highlighted ?? false,
    },
  };
}

/** `fields[0].value`: a leaf's path as the reader sees it. */
function pathText(path: readonly (string | number)[]): string {
  return toJsonPath(path).replace(/^\$\.?/, '');
}

/** Every `semantic` / `…Semantic` string in the props, with its path. */
function colours(props: unknown, path: (string | number)[] = []): KeyedValue<string>[] {
  if (Array.isArray(props)) return props.flatMap((v, i) => colours(v, [...path, i]));
  if (typeof props !== 'object' || props === null) return [];
  return Object.entries(props).flatMap(([key, value]) =>
    /semantic$/i.test(key) && typeof value === 'string'
      ? [{ key: pathText([...path, key]), value }]
      : colours(value, [...path, key]),
  );
}

/** This beat's events on `id` or its inner elements (focus moves are listed apart). */
function eventsOn(id: string, ctx: ItemContext): EventDescription[] {
  return ctx.scene.events.flatMap((event) => {
    if (event.action === 'focus') return [];
    const targets = event.targets.filter((t) => t === id || t.startsWith(`${id}/`));
    return targets.map((target) => describeEvent(event, target === id ? undefined : target, ctx));
  });
}

function describeEvent(
  event: SceneEvent,
  target: string | undefined,
  ctx: ItemContext,
): EventDescription {
  const parts = eventParts(event.params);
  return {
    action: event.action,
    at: describeAnchor(event.at, ctx.words),
    ...(target ? { target } : {}),
    ...(parts ? { parts } : {}),
    ...(event.params?.hold === true ? { hold: true } : {}),
    ...(event.params?.stagger === 'scan' ? { scan: true } : {}),
  };
}

function focusOf(scene: BeatScene, words: Words): BoardDescription['focus'] {
  const start = scene.focus.length > 0 ? [{ ids: scene.focus, at: 'start' as const }] : [];
  const moves = scene.events
    .filter((e) => e.action === 'focus')
    .map((e) => ({ ids: e.targets, at: describeAnchor(e.at, words) }));
  return [...start, ...moves];
}

/** Each pattern element on the beat's board (`<instance>/<id>`): its type and screen texts. */
function innerTexts(
  spec: RenderableVideoSpec,
  beatId: string,
  registries: Registries,
): Map<string, { type: string; texts: string[] }> {
  const world = beatWorld(spec, effectiveTiming(spec), beatId, 30, registries);
  return new Map(
    world.flatMap((w) =>
      w.kind === 'primitive' && w.key.includes('/')
        ? [
            [
              w.key,
              {
                type: w.definition.id,
                texts: propLeaves(w.definition, w.props).flatMap((l) =>
                  l.kind === 'text' ? [l.value] : l.kind === 'number' ? [String(l.value)] : [],
                ),
              },
            ] as const,
          ]
        : [],
    ),
  );
}
