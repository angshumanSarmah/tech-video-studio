import {
  toJsonPath,
  type BeatScene,
  type SceneEvent,
  type SpecError,
} from '@explainer-studio/shared';
import { EventPartsSchema } from '../primitives/parts.ts';
import type { Registries } from './registries.ts';
import type { Scope, ScopeEntry } from './scope.ts';

/**
 * Registry checks that relate ids to each other: events that name parts (`params.parts`) and
 * props that point to other elements (`elementRefs`). Both read the beat's scope, so an element
 * inherited through `continuesPrevious` counts.
 */

type Path = (string | number)[];

/** Errors for one event's `params.parts`; `undefined` when the event names no parts. */
export function partErrors(event: SceneEvent, path: Path, scope: Scope): SpecError[] | undefined {
  if (event.params?.parts === undefined) return undefined;
  const partsPath = [...path, 'params', 'parts'];
  const parsed = EventPartsSchema.safeParse(event.params.parts);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: toJsonPath([...partsPath, ...issue.path]),
      code: issue.code,
      message: issue.message,
    }));
  }
  const [target, ...others] = event.targets;
  if (target === undefined || others.length > 0) {
    return [
      error(
        partsPath,
        'parts_need_one_target',
        'An event that names parts has exactly one target.',
      ),
    ];
  }
  const entry = scope.get(target);
  if (!entry?.actions) return [];
  return partsOf(entry, target, parsed.data, event, path);
}

function partsOf(
  entry: ScopeEntry,
  target: string,
  parts: readonly string[],
  event: SceneEvent,
  path: Path,
): SpecError[] {
  const partsPath = [...path, 'params', 'parts'];
  if (!entry.parts) {
    return [
      error(partsPath, 'unknown_part', `"${target}" (${entry.label}) has no parts to address.`),
    ];
  }
  const { ids, actions } = entry.parts;
  const unknown = parts.flatMap((id, k) =>
    ids.includes(id)
      ? []
      : [
          error(
            [...partsPath, k],
            'unknown_part',
            `"${target}" has no part "${id}". Its parts: ${ids.join(', ')}.`,
          ),
        ],
  );
  if (actions.includes(event.action)) return unknown;
  const message =
    `Parts of "${target}" (${entry.label}) do not support "${event.action}". ` +
    `Supported: ${actions.join(', ')}.`;
  return [...unknown, error([...path, 'action'], 'unsupported_action', message)];
}

/** Element refs in an element's props that are missing from the scope, point to itself, or to the wrong kind. */
export function elementRefErrors(
  scene: BeatScene,
  i: number,
  scope: Scope,
  { primitives }: Registries,
): SpecError[] {
  return scene.elements.flatMap((element, j) => {
    const definition = primitives.get(element.primitive);
    if (!definition?.elementRefs) return [];
    const props = definition.propsSchema.safeParse(element.props);
    if (!props.success) return [];
    const propsPath = ['scenes', i, 'elements', j, 'props'];
    return definition.elementRefs(props.data).flatMap((ref) => {
      const path = [...propsPath, ...ref.path];
      if (ref.id === element.id) {
        return [error(path, 'invalid_element_ref', `"${element.id}" cannot point to itself.`)];
      }
      const entry = scope.get(ref.id);
      if (!entry) {
        const known = [...scope.keys()].filter((id) => id !== element.id).join(', ');
        return [
          error(
            path,
            'unknown_element',
            `No element "${ref.id}" in this beat. In scope: ${known}.`,
          ),
        ];
      }
      if (ref.primitives && !ref.primitives.includes(entry.label)) {
        const message = `"${ref.id}" is a ${entry.label}; expected ${ref.primitives.join(' or ')}.`;
        return [error(path, 'invalid_element_ref', message)];
      }
      return [];
    });
  });
}

function error(path: Path, code: string, message: string): SpecError {
  return { path: toJsonPath(path), code, message };
}
