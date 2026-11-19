import {
  anchorProblem,
  EventAnchorSchema,
  narrationWords,
  splitInnerTarget,
  toJsonPath,
  type BeatScene,
  type SceneEvent,
  type SpecError,
  type VideoSpec,
} from '@explainer-studio/shared';
import { patternLayoutModes } from '../layout/modes.ts';
import { expansionProblems } from '../patterns/expansion-checks.ts';
import type { AnyPatternDefinition, PatternExpansion } from '../patterns/types.ts';
import type { Registries } from './registries.ts';
import type { Scope } from './scope.ts';

/**
 * Registry checks for pattern instances in a spec's scenes. Errors: params that fail the
 * pattern's schema, params that expand into invalid elements (`invalid_pattern_expansion`, a
 * safety net: param schemas are written so this never happens), anchors in `params.at` outside
 * the beat's narration (`anchor_out_of_range`) and `<instance>/<id>` targets naming no element of
 * the expansion (`unknown_reference`). Warnings: asset ids inside expansions that are not in the
 * asset registry (`unknown_asset`) and patterns in one beat that disagree on the layout mode
 * while the scene sets none (`pattern_layout_conflict`).
 */

type Path = PropertyKey[];

type Instance = {
  definition: AnyPatternDefinition;
  params: unknown;
  path: Path;
};

/** Errors for the beat's pattern instances; `words` is undefined until the script exists. */
export function patternErrors(
  scene: BeatScene,
  i: number,
  words: readonly string[] | undefined,
  registries: Registries,
): SpecError[] {
  return scene.patterns.flatMap((pattern, j) => {
    const path = ['scenes', i, 'patterns', j];
    const definition = registries.patterns.get(pattern.pattern);
    if (!definition) return [unknownPattern([...path, 'pattern'], pattern.pattern, registries)];
    const params = definition.paramsSchema.safeParse(pattern.params);
    if (!params.success) {
      return params.error.issues.map((issue) =>
        error([...path, 'params', ...issue.path], issue.code, issue.message),
      );
    }
    const instance = { definition, params: params.data, path };
    return [...expansionErrors(instance, registries), ...anchorErrors(instance, words)];
  });
}

function unknownPattern(path: Path, id: string, { patterns }: Registries): SpecError {
  const known = [...patterns.keys()];
  const hint = known.length > 0 ? `Use one of: ${known.join(', ')}.` : 'No patterns exist yet.';
  return error(path, 'unknown_reference', `Unknown pattern "${id}". ${hint}`);
}

function expansionErrors({ definition, params, path }: Instance, registries: Registries) {
  const expansion = definition.expand(params);
  return expansionProblems(expansion, definition.layoutMode, registries.primitives).map((problem) =>
    error(
      [...path, 'params'],
      'invalid_pattern_expansion',
      `${definition.id}: these params expand badly: ${problem}.`,
    ),
  );
}

/** Each declared anchor present in `params.at` must land in the beat's narration. */
function anchorErrors(
  { definition, params, path }: Instance,
  words: readonly string[] | undefined,
) {
  if (!words) return [];
  const at = (params as { at?: Record<string, unknown> }).at ?? {};
  return definition.anchors.flatMap((anchor) => {
    const parsed = EventAnchorSchema.safeParse(at[anchor.name]);
    const message = parsed.success ? anchorProblem(parsed.data, words) : undefined;
    return message
      ? [error([...path, 'params', 'at', anchor.name], 'anchor_out_of_range', message)]
      : [];
  });
}

/** Narration words per beat, for the anchor checks. */
export function wordsByBeat(spec: VideoSpec): Map<string, string[]> {
  return new Map((spec.script ?? []).map((s) => [s.beatId, narrationWords(s.narration)]));
}

/**
 * `<instance>/<id>` targets whose instance is a known, valid pattern but whose inner id is not in
 * its expansion. Unknown instances are reported by the shape checks; invalid params above.
 */
export function innerTargetErrors(event: SceneEvent, path: Path, scope: Scope): SpecError[] {
  return event.targets.flatMap((target, t) => {
    const split = splitInnerTarget(target);
    if (!split || scope.has(target)) return [];
    const owner = scope.get(split.instance);
    if (!owner?.inner) return [];
    const message =
      `"${split.instance}" (${owner.label}) has no element "${split.inner}". ` +
      `Its elements: ${owner.inner.join(', ')}.`;
    return [error([...path, 'targets', t], 'unknown_reference', message)];
  });
}

/** `unknown_asset` and `pattern_layout_conflict` warnings for every scene's patterns. */
export function patternWarnings(spec: VideoSpec, registries: Registries): SpecError[] {
  return (spec.scenes ?? []).flatMap((scene, i) => [
    ...layoutConflict(scene, i, registries),
    ...scene.patterns.flatMap((pattern, j) => {
      const definition = registries.patterns.get(pattern.pattern);
      const params = definition?.paramsSchema.safeParse(pattern.params);
      if (!definition || !params?.success) return [];
      const path = ['scenes', i, 'patterns', j, 'params'];
      return assetWarnings(definition.expand(params.data), path, registries);
    }),
  ]);
}

function layoutConflict(scene: BeatScene, i: number, registries: Registries): SpecError[] {
  if (scene.layoutMode !== undefined) return [];
  const modes = patternLayoutModes(scene, registries.patterns);
  if (modes.length < 2) return [];
  const message =
    `The patterns in this beat ask for different layout modes (${modes.join(', ')}); the first ` +
    'one is used. Set scenes[].layoutMode to choose, or split the beat.';
  return [error(['scenes', i, 'layoutMode'], 'pattern_layout_conflict', message)];
}

/** Asset ids the expanded elements use that are not in the asset registry. */
function assetWarnings(expansion: PatternExpansion, path: Path, registries: Registries) {
  const known = [...registries.assets.keys()].join(', ');
  return expansion.elements.flatMap((element) => {
    const definition = registries.primitives.get(element.primitive);
    const props = definition?.propsSchema.safeParse(element.props);
    if (!definition?.assetRefs || !props?.success) return [];
    return definition
      .assetRefs(props.data)
      .filter((ref) => !registries.assets.has(ref.id))
      .map((ref) =>
        error(
          path,
          'unknown_asset',
          `Unknown asset "${ref.id}" on "${element.id}" (drawn as a placeholder). ` +
            `Use one of: ${known}.`,
        ),
      );
  });
}

function error(path: Path, code: string, message: string): SpecError {
  return { path: toJsonPath(path), code, message };
}
