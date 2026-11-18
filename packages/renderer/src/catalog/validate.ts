import {
  toJsonPath,
  VideoSpecShapeSchema,
  type BeatScene,
  type SceneEvent,
  type SpecError,
  type SpecValidationResult,
  type VideoSpec,
} from '@explainer-studio/shared';
import type { z } from 'zod';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';

/**
 * Registry checks for a spec's scenes: primitive and pattern ids exist, props and params match
 * their schemas, and events only use actions their targets support. Kept out of
 * `validateVideoSpec` because `packages/shared` cannot see the renderer's registries.
 */

type Path = (string | number)[];

/** What an id in a beat's scope refers to: a registry entry, or one we already reported. */
type ScopeEntry = { label: string; actions: readonly string[] | undefined };

/**
 * Adds registry errors to a `validateVideoSpec` / `validateRenderableVideoSpec` result. When the
 * spec failed only on cross-references, its structure still parses, so registry errors are
 * reported alongside (one repair round instead of two).
 */
export function withRegistryChecks<T extends VideoSpec>(
  result: SpecValidationResult<T>,
  input: unknown,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecValidationResult<T> {
  if (result.ok) {
    const errors = findRegistryErrors(result.spec, registries);
    if (errors.length === 0) return result;
    return { ok: false, spec: undefined, errors, warnings: result.warnings };
  }
  const shape = VideoSpecShapeSchema.safeParse(input);
  if (!shape.success) return result;
  return { ...result, errors: [...result.errors, ...findRegistryErrors(shape.data, registries)] };
}

export function findRegistryErrors(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const scenes = spec.scenes ?? [];
  const scopes = sceneScopes(scenes, registries);
  return scenes.flatMap((scene, i) => [
    ...elementErrors(scene, i, registries),
    ...patternErrors(scene, i, registries),
    ...actionErrors(scene, i, scopes[i] ?? new Map<string, ScopeEntry>()),
  ]);
}

function elementErrors(scene: BeatScene, i: number, { primitives }: Registries): SpecError[] {
  return scene.elements.flatMap((element, j) => {
    const path = ['scenes', i, 'elements', j];
    const definition = primitives.get(element.primitive);
    if (!definition) {
      return [unknownId([...path, 'primitive'], 'primitive', element.primitive, primitives)];
    }
    return schemaErrors(definition.propsSchema, element.props, [...path, 'props']);
  });
}

function patternErrors(scene: BeatScene, i: number, { patterns }: Registries): SpecError[] {
  return scene.patterns.flatMap((pattern, j) => {
    const path = ['scenes', i, 'patterns', j];
    const definition = patterns.get(pattern.pattern);
    if (!definition) return [unknownId([...path, 'pattern'], 'pattern', pattern.pattern, patterns)];
    return schemaErrors(definition.paramsSchema, pattern.params, [...path, 'params']);
  });
}

function schemaErrors(schema: z.ZodType, value: unknown, path: Path): SpecError[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: toJsonPath([...path, ...issue.path]),
    code: issue.code,
    message: issue.message,
  }));
}

function unknownId(
  path: Path,
  what: 'primitive' | 'pattern',
  id: string,
  registry: ReadonlyMap<string, unknown>,
): SpecError {
  const known = [...registry.keys()];
  const hint = known.length > 0 ? `Use one of: ${known.join(', ')}.` : `No ${what}s exist yet.`;
  return {
    path: toJsonPath(path),
    code: 'unknown_reference',
    message: `Unknown ${what} "${id}". ${hint}`,
  };
}

/** Ids each scene may target, with the actions they support; inherits through `continuesPrevious`. */
function sceneScopes(scenes: readonly BeatScene[], registries: Registries) {
  const scopes: Map<string, ScopeEntry>[] = [];
  scenes.forEach((scene, i) => {
    const inherited = scene.continuesPrevious && i > 0 ? (scopes[i - 1] ?? []) : [];
    const scope = new Map<string, ScopeEntry>(inherited);
    for (const e of scene.elements) {
      const definition = registries.primitives.get(e.primitive);
      scope.set(e.id, { label: e.primitive, actions: definition?.actions });
    }
    for (const p of scene.patterns) {
      const definition = registries.patterns.get(p.pattern);
      scope.set(p.id, { label: p.pattern, actions: definition?.actions });
    }
    scopes.push(scope);
  });
  return scopes;
}

/** Unknown targets are reported by the shape checks, unknown registry ids above; skip both here. */
function actionErrors(scene: BeatScene, i: number, scope: Map<string, ScopeEntry>): SpecError[] {
  return scene.events.flatMap((event, e) =>
    event.targets.flatMap((target, t) => {
      const entry = scope.get(target);
      if (!entry?.actions || entry.actions.includes(event.action)) return [];
      return [unsupportedAction(['scenes', i, 'events', e, 'targets', t], event, target, entry)];
    }),
  );
}

function unsupportedAction(
  path: Path,
  event: SceneEvent,
  target: string,
  entry: ScopeEntry,
): SpecError {
  return {
    path: toJsonPath(path),
    code: 'unsupported_action',
    message:
      `"${target}" (${entry.label}) does not support "${event.action}". ` +
      `Supported: ${(entry.actions ?? []).join(', ')}.`,
  };
}
