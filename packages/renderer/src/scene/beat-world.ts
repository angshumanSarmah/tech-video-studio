import type {
  BeatScene,
  BeatTiming,
  EffectiveTiming,
  RenderableVideoSpec,
  SceneElement,
  SceneEvent,
  ScenePattern,
} from '@explainer-studio/shared';
import type { Registries } from '../catalog/registries.ts';
import {
  focusChangeSecs,
  focusChanges,
  focusTrack,
  NO_FOCUS,
  overlayToggles,
  type FocusTrack,
} from '../events/focus.ts';
import { ZOOM_PUSH_SEC } from '../events/presets.ts';
import { resolveElementEvents, type AnchoredEvent } from '../events/resolve.ts';
import { incomingTransition } from '../events/transitions.ts';
import type { ElementEvent } from '../primitives/element-state.ts';
import type { AnyPrimitiveDefinition, PrimitiveLayer } from '../primitives/types.ts';
import { anchorToTime } from '../timing/frames.ts';

/**
 * What a beat shows: its own elements and expanded patterns, plus everything inherited through
 * `continuesPrevious`, each with the events that act on it (from every beat in the chain, resolved
 * by the event engine: stagger, highlight lead and clear) and its focus keys. Ids
 * that are not in a registry, or props that fail their schema, become error items: the scene
 * layer draws them as red markers that are clearly not content. Final renders refuse such specs
 * (`withRegistryChecks`), so markers only ever appear in Studio and drafts.
 *
 * Elements a container points to with a `contains` ref (an `inset_panel`'s children) are nested
 * under it as `children` instead of standing on the board. The first container to claim an
 * element keeps it; overlays are never nested (validation reports both).
 */

export type WorldItem =
  | {
      kind: 'primitive';
      key: string;
      definition: AnyPrimitiveDefinition;
      /** Parsed by the definition's schema. */
      props: unknown;
      events: ElementEvent[];
      /** Focus and overlay dim over the chain (`events/focus.ts`); none for overlays and children. */
      focus: FocusTrack;
      layer: PrimitiveLayer;
      /** Zone of the beat's layout mode the element asked for (input to the layout engine). */
      zone?: string;
      /** Contained elements, drawn inside this one. */
      children: WorldItem[];
    }
  | { kind: 'error'; key: string; title: string; detail: string };

type Draft =
  | {
      kind: 'primitive';
      key: string;
      definition: AnyPrimitiveDefinition;
      props: unknown;
      zone?: string;
      targetIds: string[];
    }
  | { kind: 'error'; key: string; title: string; detail: string };

/** A draft and the start (global seconds) of the beat that adds it. */
type Placed = { draft: Draft; sinceSec: number };

type Context = {
  beat: BeatTiming | undefined;
  narration: string;
  fps: number;
  registries: Registries;
};

export function beatWorld(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  beatId: string,
  fps: number,
  registries: Registries,
): WorldItem[] {
  const drafts = new Map<string, Placed>();
  const events: AnchoredEvent[] = [];
  const beats: { focus: readonly string[]; startSec: number }[] = [];
  for (const scene of sceneChain(spec.scenes, beatId)) {
    const ctx: Context = {
      beat: timing.beats.find((b) => b.beatId === scene.beatId),
      narration: spec.script.find((s) => s.beatId === scene.beatId)?.narration ?? '',
      fps,
      registries,
    };
    const sinceSec = ctx.beat?.startSec ?? 0;
    beats.push({ focus: scene.focus, startSec: sinceSec });
    for (const element of scene.elements) {
      drafts.set(element.id, { draft: elementDraft(element, [element.id], registries), sinceSec });
    }
    for (const pattern of scene.patterns) {
      const expanded = patternDrafts(pattern, ctx);
      expanded.drafts.forEach((draft) => drafts.set(draft.key, { draft, sinceSec }));
      events.push(...expanded.events);
    }
    events.push(...anchored(scene.events, ctx, (t) => t));
  }
  const push = zoomPushFocus(spec, timing, beatId);
  return nestContained(
    resolveWorld([...drafts.values()], events, push ? [...beats, push] : beats, fps),
  );
}

/**
 * When the next beat is a semantic zoom from this board, focus moves to its element as the camera
 * pushes into it (`ZOOM_PUSH_SEC` before the next beat), like a beat of its own.
 */
function zoomPushFocus(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  beatId: string,
): { focus: readonly string[]; startSec: number } | undefined {
  const index = spec.scenes.findIndex((s) => s.beatId === beatId);
  const next = spec.scenes[index + 1];
  const zoom = incomingTransition(next, index + 1);
  const startSec = timing.beats.find((b) => b.beatId === next?.beatId)?.startSec;
  if (!zoom?.semantic || !next?.zoomFrom || startSec === undefined) return undefined;
  return { focus: [next.zoomFrom], startSec: Math.max(0, startSec - ZOOM_PUSH_SEC) };
}

/** Resolves the chain's events per element and gives every item its events and focus keys. */
function resolveWorld(
  placed: readonly Placed[],
  events: readonly AnchoredEvent[],
  beats: readonly { focus: readonly string[]; startSec: number }[],
  fps: number,
): WorldItem[] {
  const drafts = placed.map((p) => p.draft);
  const keysFor = (target: string) =>
    drafts
      .filter((d) => (d.kind === 'primitive' ? d.targetIds.includes(target) : d.key === target))
      .map((d) => d.key);
  const overlays = new Set(drafts.filter(isOverlayDraft).map((d) => d.key));
  const byKey = resolveElementEvents(events, {
    fps,
    keysFor,
    partOrder: (key) => partOrder(drafts.find((d) => d.key === key)),
    focusChanges: [
      ...focusChangeSecs(events, (t) => keysFor(t).some((k) => overlays.has(k))),
      ...beats.slice(1).map((b) => b.startSec),
    ],
  });
  const hosts = hostMap(drafts);
  const track = {
    changes: focusChanges(beats, events),
    overlays: placed
      .filter((p) => overlays.has(p.draft.key))
      .flatMap((p) => overlayToggles(byKey.get(p.draft.key) ?? [], p.sinceSec)),
    hostOf: (key: string) => hosts.get(key),
  };
  const exempt = (key: string) => {
    for (let k: string | undefined = key; k !== undefined; k = hosts.get(k)) {
      if (overlays.has(k)) return true;
    }
    return false;
  };
  return drafts.map((draft) =>
    withEvents(
      draft,
      byKey.get(draft.key) ?? [],
      exempt(draft.key) ? NO_FOCUS : focusTrack(draft.key, track),
    ),
  );
}

function isOverlayDraft(draft: Draft): boolean {
  return draft.kind === 'primitive' && draft.definition.layer === 'overlay';
}

function partOrder(draft: Draft | undefined): readonly string[] {
  if (draft?.kind !== 'primitive' || !draft.definition.parts) return [];
  return draft.definition.parts.ids(draft.props);
}

/**
 * The element each element follows for focus: the one it is pinned to, or the container it is
 * drawn in. (Cycles are harmless: `inFocus` stops at a repeat.)
 */
function hostMap(drafts: readonly Draft[]): Map<string, string> {
  const hosts = new Map<string, string>();
  for (const draft of drafts) {
    if (draft.kind !== 'primitive' || !draft.definition.elementRefs) continue;
    for (const ref of draft.definition.elementRefs(draft.props)) {
      if (ref.pin) hosts.set(draft.key, ref.id);
      if (ref.contains && !hosts.has(ref.id)) hosts.set(ref.id, draft.key);
    }
  }
  return hosts;
}

/** Scene or pattern events at their anchors' global seconds (unmatched anchors dropped). */
function anchored(
  events: readonly SceneEvent[],
  ctx: Context,
  rename: (target: string) => string,
): AnchoredEvent[] {
  const beat = ctx.beat;
  if (!beat) return [];
  return events.flatMap((event) => {
    const time = anchorToTime(event.at, beat, ctx.narration, ctx.fps);
    if (!time) return [];
    return [
      {
        action: event.action,
        targets: event.targets.map(rename),
        ...(event.params ? { params: event.params } : {}),
        sec: time.sec,
        beatStartSec: beat.startSec,
        beatEndSec: beat.endSec,
      },
    ];
  });
}

/** Moves contained elements under their container (see the module comment). */
export function nestContained(items: readonly WorldItem[]): WorldItem[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const owner = new Map<string, string>();
  for (const item of items) {
    for (const id of containedIds(item)) {
      const child = byKey.get(id);
      const overlay = child?.kind === 'primitive' && child.layer === 'overlay';
      if (child && !overlay && id !== item.key && !owner.has(id)) owner.set(id, item.key);
    }
  }
  const nest = (item: WorldItem): WorldItem =>
    item.kind === 'primitive'
      ? { ...item, children: items.filter((c) => owner.get(c.key) === item.key).map(nest) }
      : item;
  return items.filter((item) => !owner.has(item.key)).map(nest);
}

function containedIds(item: WorldItem): string[] {
  if (item.kind !== 'primitive' || !item.definition.elementRefs) return [];
  return item.definition
    .elementRefs(item.props)
    .filter((ref) => ref.contains)
    .map((ref) => ref.id);
}

/** The beat's scene, preceded by the scenes it continues (oldest first). */
export function sceneChain(scenes: readonly BeatScene[], beatId: string): BeatScene[] {
  const index = scenes.findIndex((s) => s.beatId === beatId);
  if (index < 0) return [];
  let first = index;
  while (first > 0 && scenes[first]?.continuesPrevious) first -= 1;
  return scenes.slice(first, index + 1);
}

function elementDraft(element: SceneElement, targetIds: string[], registries: Registries): Draft {
  const definition = registries.primitives.get(element.primitive);
  if (!definition) {
    return {
      kind: 'error',
      key: targetIds[0] ?? element.id,
      title: 'Unknown primitive',
      detail: `${element.primitive} · ${element.id}`,
    };
  }
  const props = definition.propsSchema.safeParse(element.props);
  if (!props.success) {
    return {
      kind: 'error',
      key: targetIds[0] ?? element.id,
      title: 'Invalid props',
      detail: `${element.primitive} · ${element.id}`,
    };
  }
  return {
    kind: 'primitive',
    key: targetIds[0] ?? element.id,
    definition,
    props: props.data,
    ...(element.zone ? { zone: element.zone } : {}),
    targetIds,
  };
}

/**
 * A registered pattern's elements, namespaced `<instance>/<id>` so they never collide with spec
 * ids (element refs in their props too, so a connector inside the pattern points to its sibling).
 * Spec events that target the instance act on every element; `<instance>/<id>` targets one.
 */
function patternDrafts(
  pattern: ScenePattern,
  ctx: Context,
): { drafts: Draft[]; events: AnchoredEvent[] } {
  const definition = ctx.registries.patterns.get(pattern.pattern);
  const params = definition?.paramsSchema.safeParse(pattern.params);
  if (!definition || !params?.success) {
    const title = definition ? 'Invalid params' : 'Unknown pattern';
    return {
      drafts: [
        { kind: 'error', key: pattern.id, title, detail: `${pattern.pattern} · ${pattern.id}` },
      ],
      events: [],
    };
  }
  const expansion = definition.expand(params.data);
  const part = (id: string) => `${pattern.id}/${id}`;
  return {
    drafts: expansion.elements.map((e) =>
      namespaceRefs(elementDraft(e, [part(e.id), pattern.id], ctx.registries), part),
    ),
    events: anchored(expansion.events, ctx, part),
  };
}

/** Rewrites the element refs in a draft's parsed props through `rename`. */
function namespaceRefs(draft: Draft, rename: (id: string) => string): Draft {
  if (draft.kind === 'error' || !draft.definition.elementRefs) return draft;
  const refs = draft.definition.elementRefs(draft.props);
  if (refs.length === 0) return draft;
  const props: unknown = structuredClone(draft.props);
  for (const ref of refs) setAtPath(props, ref.path, rename(ref.id));
  return { ...draft, props };
}

function setAtPath(target: unknown, path: readonly (string | number)[], value: string): void {
  const last = path.at(-1);
  let node = target;
  for (const key of path.slice(0, -1)) node = (node as Record<string | number, unknown>)[key];
  if (last !== undefined) (node as Record<string | number, unknown>)[last] = value;
}

function withEvents(draft: Draft, events: ElementEvent[], focus: FocusTrack): WorldItem {
  if (draft.kind === 'error') return draft;
  const { kind, key, definition, props, zone } = draft;
  const layer = definition.layer ?? 'board';
  return {
    kind,
    key,
    definition,
    props,
    ...(zone ? { zone } : {}),
    events,
    focus,
    layer,
    children: [],
  };
}
