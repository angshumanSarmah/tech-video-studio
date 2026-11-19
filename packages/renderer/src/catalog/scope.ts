import type { BeatScene } from '@explainer-studio/shared';
import type { Registries } from './registries.ts';

/**
 * What each id in a beat's scope refers to: its registry label (primitive or pattern id), the
 * actions it supports and, for primitives with parts, the part ids its props declare. Undefined
 * actions mean the id is unknown to the registry (reported elsewhere).
 */
export type ScopeEntry = {
  label: string;
  actions: readonly string[] | undefined;
  parts?: { actions: readonly string[]; ids: readonly string[] };
};

export type Scope = ReadonlyMap<string, ScopeEntry>;

/** Ids each scene may target, inheriting the previous scene's through `continuesPrevious`. */
export function sceneScopes(scenes: readonly BeatScene[], registries: Registries): Scope[] {
  const scopes: Scope[] = [];
  scenes.forEach((scene, i) => {
    const inherited = scene.continuesPrevious && i > 0 ? (scopes[i - 1] ?? []) : [];
    const scope = new Map<string, ScopeEntry>(inherited);
    for (const e of scene.elements) scope.set(e.id, elementEntry(e, registries));
    for (const p of scene.patterns) {
      const definition = registries.patterns.get(p.pattern);
      scope.set(p.id, { label: p.pattern, actions: definition?.actions });
    }
    scopes.push(scope);
  });
  return scopes;
}

function elementEntry(element: BeatScene['elements'][number], registries: Registries): ScopeEntry {
  const definition = registries.primitives.get(element.primitive);
  const entry: ScopeEntry = { label: element.primitive, actions: definition?.actions };
  if (!definition?.parts) return entry;
  const props = definition.propsSchema.safeParse(element.props);
  // Invalid props are reported as schema errors; their parts are unknown, not empty.
  if (!props.success) return { ...entry, actions: undefined };
  return {
    ...entry,
    parts: { actions: definition.parts.actions, ids: definition.parts.ids(props.data) },
  };
}
