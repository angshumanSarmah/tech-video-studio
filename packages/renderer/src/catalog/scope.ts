import type { BeatScene, SceneElement, ScenePattern } from '@explainer-studio/shared';
import { INNER_TARGET_ACTIONS } from '../patterns/types.ts';
import type { Registries } from './registries.ts';

/**
 * What each id in a beat's scope refers to: its registry label (primitive or pattern id), the
 * actions it supports and, for primitives with parts, the part ids its props declare. Undefined
 * actions mean the id is unknown to the registry (reported elsewhere).
 *
 * A pattern instance with valid params also lists its expanded element ids (`inner`), and each
 * of them is in scope as `<instance>/<id>` with only `INNER_TARGET_ACTIONS` (the pattern keeps
 * the rest).
 */
export type ScopeEntry = {
  label: string;
  actions: readonly string[] | undefined;
  parts?: { actions: readonly string[]; ids: readonly string[] };
  inner?: readonly string[];
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
      for (const [id, entry] of patternEntries(p, registries)) scope.set(id, entry);
    }
    scopes.push(scope);
  });
  return scopes;
}

/** The instance, then `<instance>/<id>` for each expanded element (when its params are valid). */
function patternEntries(p: ScenePattern, registries: Registries): [string, ScopeEntry][] {
  const definition = registries.patterns.get(p.pattern);
  const instance: ScopeEntry = { label: p.pattern, actions: definition?.actions };
  const params = definition?.paramsSchema.safeParse(p.params);
  if (!definition || !params?.success) return [[p.id, instance]];
  const elements = definition.expand(params.data).elements;
  return [
    [p.id, { ...instance, inner: elements.map((e) => e.id) }],
    ...elements.map((e): [string, ScopeEntry] => [
      `${p.id}/${e.id}`,
      innerEntry(elementEntry(e, registries)),
    ]),
  ];
}

/** An element inside a pattern: spec events may only use `INNER_TARGET_ACTIONS` on it. */
function innerEntry(entry: ScopeEntry): ScopeEntry {
  const allowed = (actions: readonly string[]) =>
    actions.filter((a) => (INNER_TARGET_ACTIONS as readonly string[]).includes(a));
  return {
    ...entry,
    actions: entry.actions && allowed(entry.actions),
    ...(entry.parts ? { parts: { ...entry.parts, actions: allowed(entry.parts.actions) } } : {}),
  };
}

function elementEntry(element: SceneElement, registries: Registries): ScopeEntry {
  const definition = registries.primitives.get(element.primitive);
  const entry: ScopeEntry = { label: element.primitive, actions: definition?.actions };
  if (!definition?.parts) return entry;
  const props = definition.propsSchema.safeParse(element.props);
  // Invalid props are reported as schema errors; their parts are unknown, not empty.
  if (!props.success) return { ...entry, actions: undefined };
  const ids = definition.parts.ids(props.data);
  // A primitive whose parts are optional (a `node_card` without a role) has none to address.
  if (ids.length === 0) return entry;
  return { ...entry, parts: { actions: definition.parts.actions, ids } };
}
