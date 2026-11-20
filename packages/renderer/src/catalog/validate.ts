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
import { EventEngineParamsSchema } from '../events/params.ts';
import { LAYOUT_MODES } from '../layout/modes.ts';
import { elementAssetUses, unknownAssetWarnings } from './asset-uses.ts';
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
 * Registry checks for a spec's scenes: layout modes, primitive and pattern ids exist, props and params match
 * their schemas (pattern instances: `pattern-checks.ts`), events only use actions their targets
 * (or the parts they name, or `<instance>/<id>` inside a pattern) support, props
 * only point to elements in the beat's scope (errors), and asset ids exist in the library or
 * name a declared logo slot (`unknown_asset` warnings: the scene layer draws a placeholder,
 * agents repair it; `asset-uses.ts`). Timeline
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
  return [...storyRegistryErrors(spec, registries), ...sceneRegistryErrors(spec, registries)];
}

/**
 * The Story layer's registry ids: suggested patterns, and each missing-primitive request's
 * fallback (a primitive or a pattern).
 */
function storyRegistryErrors(spec: VideoSpec, registries: Registries): SpecError[] {
  const { story } = spec;
  const fallbacks = new Map<string, unknown>([...registries.primitives, ...registries.patterns]);
  return [
    ...story.beats.flatMap((beat, i) =>
      beat.suggestedPatternIds.flatMap((id, j) =>
        registries.patterns.has(id)
          ? []
          : [
              unknownId(
                ['story', 'beats', i, 'suggestedPatternIds', j],
                'pattern',
                id,
                registries.patterns,
              ),
            ],
      ),
    ),
    ...story.missingPrimitiveRequests.flatMap((request, i) =>
      fallbacks.has(request.fallbackUsed)
        ? []
        : [
            unknownId(
              ['story', 'missingPrimitiveRequests', i, 'fallbackUsed'],
              'primitive or pattern',
              request.fallbackUsed,
              fallbacks,
            ),
          ],
    ),
  ];
}

function sceneRegistryErrors(spec: VideoSpec, registries: Registries): SpecError[] {
  const scenes = spec.scenes ?? [];
  const scopes = sceneScopes(scenes, registries);
  const words = wordsByBeat(spec);
  return scenes.flatMap((scene, i) => {
    const scope: Scope = scopes[i] ?? new Map<string, ScopeEntry>();
    return [
      ...layoutModeErrors(scene, i),
      ...elementErrors(scene, i, registries),
      ...patternErrors(scene, i, words.get(scene.beatId), registries),
      ...actionErrors(scene, i, scope),
      ...scene.events.flatMap((event, e) => eventParamErrors(event, ['scenes', i, 'events', e])),
      ...elementRefErrors(scene, i, scope, registries),
    ];
  });
}

/** Warnings never make a spec invalid; agent output treats them as failures (repair loop). */
export function findRegistryWarnings(
  spec: VideoSpec,
  registries: Registries = DEFAULT_REGISTRIES,
): SpecError[] {
  const elementUses = (spec.scenes ?? []).flatMap((scene, i) =>
    scene.elements.flatMap((element, j) =>
      elementAssetUses(element, ['scenes', i, 'elements', j], scene.beatId, registries),
    ),
  );
  return [
    ...unknownAssetWarnings(elementUses, spec, registries),
    ...patternWarnings(spec, registries),
    ...findTimelineWarnings(spec, registries),
  ];
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

/** A scene's own `layoutMode` must be a registered layout mode. */
function layoutModeErrors(scene: BeatScene, i: number): SpecError[] {
  if (scene.layoutMode === undefined || LAYOUT_MODES.has(scene.layoutMode)) return [];
  return [unknownId(['scenes', i, 'layoutMode'], 'layout mode', scene.layoutMode, LAYOUT_MODES)];
}

function unknownId(
  path: Path,
  what: 'primitive' | 'pattern' | 'primitive or pattern' | 'layout mode',
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
 * An event that names parts is checked against its target's part actions instead. `focus` is the
 * engine's own action (it moves the beat's focus to its targets), valid on anything in scope.
 */
function actionErrors(scene: BeatScene, i: number, scope: Scope): SpecError[] {
  return scene.events.flatMap((event, e) => {
    const inner = innerTargetErrors(event, ['scenes', i, 'events', e], scope);
    if (inner.length > 0) return inner;
    const parts = partErrors(event, ['scenes', i, 'events', e], scope);
    if (parts) return parts;
    if (event.action === 'focus') return [];
    return event.targets.flatMap((target, t) => {
      const entry = scope.get(target);
      if (!entry?.actions || entry.actions.includes(event.action)) return [];
      return [unsupportedAction(['scenes', i, 'events', e, 'targets', t], event, target, entry)];
    });
  });
}

/** The engine's event params (`hold`, `stagger`) must parse; `hold` is for highlights only. */
function eventParamErrors(event: SceneEvent, path: Path): SpecError[] {
  if (!event.params) return [];
  const errors = schemaErrors(EventEngineParamsSchema, event.params, [...path, 'params']);
  if (event.params.hold !== undefined && event.action !== 'highlight') {
    errors.push({
      path: toJsonPath([...path, 'params', 'hold']),
      code: 'invalid_event_param',
      message: `"hold" keeps a highlight on; it does nothing on "${event.action}".`,
    });
  }
  return errors;
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
