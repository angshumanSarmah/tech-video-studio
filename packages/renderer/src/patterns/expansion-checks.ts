import type { SceneElement, SceneEvent } from '@explainer-studio/shared';
import { LAYOUT_MODES } from '../layout/modes.ts';
import { eventParts } from '../primitives/parts.ts';
import type { PrimitiveRegistry } from '../primitives/registry.ts';
import type { AnyPrimitiveDefinition, ElementRef } from '../primitives/types.ts';
import type { PatternExpansion, PatternTarget } from './types.ts';

/**
 * Why an expansion is invalid, as messages: unknown primitives, bad props, duplicate ids, zones
 * outside the layout mode, element refs that leave the expansion, and events with unknown
 * targets, unsupported actions or bad parts. Pure; registry building runs it on each example and
 * spec validation on every pattern instance.
 */

type Parsed = { element: SceneElement; definition: AnyPrimitiveDefinition; props: unknown };

export function expansionProblems(
  expansion: PatternExpansion,
  layoutMode: string,
  primitives: PrimitiveRegistry,
): string[] {
  const ids = expansion.elements.map((e) => e.id);
  const parsed = new Map<string, Parsed>();
  const elementProblems = expansion.elements.flatMap((element) => {
    const definition = primitives.get(element.primitive);
    if (!definition) return [`unknown primitive "${element.primitive}"`];
    const props = definition.propsSchema.safeParse(element.props);
    if (!props.success) return [`invalid props on "${element.id}": ${props.error.message}`];
    parsed.set(element.id, { element, definition, props: props.data });
    return [];
  });
  return [
    ...ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `duplicate element id "${id}"`),
    ...elementProblems,
    ...[...parsed.values()].flatMap((p) => zoneProblems(p, layoutMode)),
    ...[...parsed.values()].flatMap((p) => refProblems(p, parsed)),
    ...expansion.events.flatMap((event) => eventProblems(event, parsed, new Set(ids))),
  ];
}

function refsOf({ definition, props }: Parsed): ElementRef[] {
  return definition.elementRefs ? definition.elementRefs(props) : [];
}

/** Relational elements (with element refs) may skip the zone; every other element needs one. */
function zoneProblems(p: Parsed, layoutMode: string): string[] {
  const zones = LAYOUT_MODES.get(layoutMode)?.zones ?? [];
  const { id, zone } = p.element;
  if (zone === undefined) {
    return refsOf(p).length > 0 ? [] : [`"${id}" has no zone (${layoutMode}: ${zones.join(', ')})`];
  }
  return zones.includes(zone)
    ? []
    : [`"${id}" is in zone "${zone}", which ${layoutMode} lacks (${zones.join(', ')})`];
}

function refProblems(p: Parsed, parsed: ReadonlyMap<string, Parsed>): string[] {
  return refsOf(p).flatMap((ref) => {
    const target = parsed.get(ref.id);
    if (ref.id === p.element.id) return [`"${p.element.id}" points to itself`];
    if (!target) return [`"${p.element.id}" points to "${ref.id}", which is not in the expansion`];
    if (ref.primitives && !ref.primitives.includes(target.definition.id)) {
      return [`"${p.element.id}" points to "${ref.id}" (${target.definition.id})`];
    }
    const partIds = partIdsOf(target);
    return (ref.parts ?? [])
      .filter((part) => !partIds.includes(part))
      .map((part) => `"${p.element.id}" names part "${part}", which "${ref.id}" lacks`);
  });
}

function partIdsOf({ definition, props }: Parsed): string[] {
  return definition.parts ? definition.parts.ids(props) : [];
}

function eventProblems(
  event: SceneEvent,
  parsed: ReadonlyMap<string, Parsed>,
  known: ReadonlySet<string>,
): string[] {
  const unknown = event.targets
    .filter((t) => !known.has(t))
    .map((t) => `event targets unknown "${t}"`);
  if (unknown.length > 0) return unknown;
  const parts = eventParts(event.params);
  if (parts) return partEventProblems(event, parts, parsed);
  return event.targets.flatMap((t) => {
    const target = parsed.get(t);
    if (!target || target.definition.actions.includes(event.action)) return [];
    return [`"${t}" (${target.definition.id}) does not support "${event.action}"`];
  });
}

function partEventProblems(
  event: SceneEvent,
  parts: readonly string[],
  parsed: ReadonlyMap<string, Parsed>,
): string[] {
  const [t, ...others] = event.targets;
  if (t === undefined || others.length > 0) return ['an event that names parts needs one target'];
  const target = parsed.get(t);
  if (!target) return [];
  const partIds = partIdsOf(target);
  const missing = parts
    .filter((part) => !partIds.includes(part))
    .map((part) => `"${t}" has no part "${part}"`);
  const actions = target.definition.parts?.actions ?? [];
  return actions.includes(event.action)
    ? missing
    : [...missing, `parts of "${t}" do not support "${event.action}"`];
}

/** Ids in the expansion that match no documented target (`worker-<n>` matches `worker-2`). */
export function undocumentedTargets(
  expansion: PatternExpansion,
  targets: readonly PatternTarget[],
): string[] {
  const patterns = targets.map((t) => targetPattern(t.id));
  return expansion.elements
    .map((e) => e.id)
    .filter((id) => !patterns.some((pattern) => pattern.test(id)));
}

function targetPattern(documented: string): RegExp {
  const escaped = documented
    .split(/<[^>]+>/)
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9_-]+');
  return new RegExp(`^${escaped}$`);
}
