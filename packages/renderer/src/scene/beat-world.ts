import type {
  BeatScene,
  BeatTiming,
  EffectiveTiming,
  RenderableVideoSpec,
  SceneElement,
  ScenePattern,
} from '@explainer-studio/shared';
import type { Registries } from '../catalog/registries.ts';
import type { ElementEvent } from '../primitives/element-state.ts';
import type { AnyPrimitiveDefinition } from '../primitives/types.ts';
import { anchorToTime, resolveEventFrames, type FramedEvent } from '../timing/frames.ts';

/**
 * What a beat shows: its own elements and expanded patterns, plus everything inherited through
 * `continuesPrevious`, each with the events that act on it (from every beat in the chain, in frame order). Ids
 * that are not in a registry, or props that fail their schema, become error items: the scene
 * layer draws them as red markers that are clearly not content. Final renders refuse such specs
 * (`withRegistryChecks`), so markers only ever appear in Studio and drafts.
 */

export type WorldItem =
  | {
      kind: 'primitive';
      key: string;
      definition: AnyPrimitiveDefinition;
      /** Parsed by the definition's schema. */
      props: unknown;
      events: ElementEvent[];
    }
  | { kind: 'error'; key: string; title: string; detail: string };

type Draft =
  | {
      kind: 'primitive';
      key: string;
      definition: AnyPrimitiveDefinition;
      props: unknown;
      targetIds: string[];
    }
  | { kind: 'error'; key: string; title: string; detail: string };

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
  const drafts = new Map<string, Draft>();
  const events: FramedEvent[] = [];
  for (const scene of sceneChain(spec.scenes, beatId)) {
    const ctx: Context = {
      beat: timing.beats.find((b) => b.beatId === scene.beatId),
      narration: spec.script.find((s) => s.beatId === scene.beatId)?.narration ?? '',
      fps,
      registries,
    };
    for (const element of scene.elements)
      drafts.set(element.id, elementDraft(element, [element.id], registries));
    for (const pattern of scene.patterns) {
      const expanded = patternDrafts(pattern, ctx);
      expanded.drafts.forEach((d) => drafts.set(d.key, d));
      events.push(...expanded.events);
    }
    if (ctx.beat) events.push(...resolveEventFrames(scene, ctx.beat, ctx.narration, fps));
  }
  const ordered = events.sort((a, b) => a.frame - b.frame);
  return [...drafts.values()].map((draft) => withEvents(draft, ordered));
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
    targetIds,
  };
}

/**
 * A registered pattern's parts, namespaced `<instance>/<part>` so they never collide with spec ids.
 * Spec events that target the instance act on every part.
 */
function patternDrafts(
  pattern: ScenePattern,
  ctx: Context,
): { drafts: Draft[]; events: FramedEvent[] } {
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
      elementDraft(e, [part(e.id), pattern.id], ctx.registries),
    ),
    events: expansion.events.flatMap((event) => {
      const time = ctx.beat ? anchorToTime(event.at, ctx.beat, ctx.narration, ctx.fps) : undefined;
      if (!time) return [];
      return [
        {
          action: event.action,
          targets: event.targets.map(part),
          ...time,
          ...(event.params ? { params: event.params } : {}),
        },
      ];
    }),
  };
}

function withEvents(draft: Draft, events: readonly FramedEvent[]): WorldItem {
  if (draft.kind === 'error') return draft;
  const { targetIds, ...item } = draft;
  const mine = events
    .filter((e) => e.targets.some((t) => targetIds.includes(t)))
    .map(({ action, frame, sec, params }) => ({
      action,
      frame,
      sec,
      ...(params ? { params } : {}),
    }));
  return { ...item, events: mine };
}
