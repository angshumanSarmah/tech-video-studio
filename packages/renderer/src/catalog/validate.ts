import {
  toJsonPath,
  VideoSpecShapeSchema,
  type BeatScene,
  type SceneElement,
  type SceneEvent,
  type SpecError,
  type SpecValidationResult,
  type VideoSpec,
} from '@explainer-studio/shared';
import type { z } from 'zod';
import { DEFAULT_REGISTRIES, type Registries } from './registries.ts';
import {
  innerTargetErrors,
  patternErrors,
  patternWarnings,
  wordsByBeat,
} from './pattern-checks.ts';
import { elementRefErrors, partErrors } from './relation-checks.ts';
import { sceneScopes, type Scope, type ScopeEntry } from './scope.ts';
import { findTimelineWarnings } from './timeline-checks.ts';

/**
 * Registry checks for a spec's scenes: primitive and pattern ids exist, props and params match
 * their schemas (pattern instances: `pattern-checks.ts`), events only use actions their targets
 * (or the parts they name, or `<instance>/<id>` inside a pattern) support, props
 * only point to elements in the beat's scope (errors), and asset ids exist
 * (`unknown_asset` warnings: the scene layer draws a placeholder, agents repair it). Timeline
 * warnings (`timeline-checks.ts`): overlays shown at once, children acting before their
 * container, and each primitive's own `eventWarnings`. Kept out of
 * `validateVideoSpec` because `packages/shared` cannot see the renderer's registries.
 */

type Path = (string | number)[];

/**
 * Adds registry errors and warnings to a `validateVideoSpec` / `validateRenderableVideoSpec`
 * result. When the spec failed only on cross-references, its structure still parses, so registry
 * issues are reported alongside (one repair round instead of two).
 */
export function withRegistryChecks<T extends VideoSpec>(
  result: SpecValidationResult<T>,
  input: unknown,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecValidationResult<T> {
  if (result.ok) {
    const errors = findRegistryErrors(result.spec, registries);
    const warnings = [...result.warnings, ...findRegistryWarnings(result.spec, registries)];
    if (errors.length === 0) return { ...result, warnings };
    return { ok: false, spec: undefined, errors, warnings };
  }
  const shape = VideoSpecShapeSchema.safeParse(input);
  if (!shape.success) return result;
  return {
    ...result,
    errors: [...result.errors, ...findRegistryErrors(shape.data, registries)],
    warnings: [...result.warnings, ...findRegistryWarnings(shape.data, registries)],
  };
}

export function findRegistryErrors(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const scenes = spec.scenes ?? [];
  const scopes = sceneScopes(scenes, registries);
  const words = wordsByBeat(spec);
  return scenes.flatMap((scene, i) => {
    const scope: Scope = scopes[i] ?? new Map<string, ScopeEntry>();
    return [
      ...elementErrors(scene, i, registries),
      ...patternErrors(scene, i, words.get(scene.beatId), registries),
      ...actionErrors(scene, i, scope),
      ...elementRefErrors(scene, i, scope, registries),
    ];
  });
}

/** Warnings never make a spec invalid; agent output treats them as failures (repair loop). */
export function findRegistryWarnings(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const assets = (spec.scenes ?? []).flatMap((scene, i) =>
    scene.elements.flatMap((element, j) =>
      assetWarnings(element, ['scenes', i, 'elements', j, 'props'], registries),
    ),
  );
  return [
    ...assets,
    ...patternWarnings(spec, registries),
    ...findTimelineWarnings(spec, registries),
  ];
}

/** Asset ids in valid props that are not in the asset registry (bad props are errors already). */
function assetWarnings(element: SceneElement, path: Path, registries: Registries): SpecError[] {
  const definition = registries.primitives.get(element.primitive);
  if (!definition?.assetRefs) return [];
  const props = definition.propsSchema.safeParse(element.props);
  if (!props.success) return [];
  const known = [...registries.assets.keys()].join(', ');
  return definition
    .assetRefs(props.data)
    .filter((ref) => !registries.assets.has(ref.id))
    .map((ref) => ({
      path: toJsonPath([...path, ...ref.path]),
      code: 'unknown_asset',
      message: `Unknown asset "${ref.id}" (drawn as a placeholder). Use one of: ${known}.`,
    }));
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
  what: 'primitive',
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

/**
 * Unknown targets are reported by the shape checks, unknown registry ids above; skip both here.
 * An event that names parts is checked against its target's part actions instead.
 */
function actionErrors(scene: BeatScene, i: number, scope: Scope): SpecError[] {
  return scene.events.flatMap((event, e) => {
    const inner = innerTargetErrors(event, ['scenes', i, 'events', e], scope);
    if (inner.length > 0) return inner;
    const parts = partErrors(event, ['scenes', i, 'events', e], scope);
    if (parts) return parts;
    return event.targets.flatMap((target, t) => {
      const entry = scope.get(target);
      if (!entry?.actions || entry.actions.includes(event.action)) return [];
      return [unsupportedAction(['scenes', i, 'events', e, 'targets', t], event, target, entry)];
    });
  });
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
