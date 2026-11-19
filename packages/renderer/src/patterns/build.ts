import type { EventAction, EventAnchor, SceneElement, SceneEvent } from '@explainer-studio/shared';
import { z } from 'zod';
import { AssetIdSchema, lineText } from '../primitives/common-props.ts';

/**
 * Small builders the pattern definitions share, so each `expand` reads as choreography. Text
 * limits in param schemas match the primitive they end up in, so valid params always expand into
 * valid props.
 */

/** One expanded element; `zone` is a zone of the pattern's layout mode. */
export function el(
  id: string,
  primitive: string,
  props: Record<string, unknown>,
  zone?: string,
): SceneElement {
  return { id, primitive, props, ...(zone ? { zone } : {}) };
}

/** One event per call; `parts` makes it a part event on its single target. */
/** The event as a deliberate one-by-one sweep (`params.stagger: 'scan'`). */
export function scan(event: SceneEvent): SceneEvent {
  return { ...event, params: { ...event.params, stagger: 'scan' } };
}

export function on(
  at: EventAnchor,
  action: EventAction,
  targets: readonly string[],
  parts?: readonly string[],
): SceneEvent {
  return { at, action, targets: [...targets], ...(parts ? { params: { parts: [...parts] } } : {}) };
}

/** A connector element from one expanded element to another. */
export function link(
  id: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
): SceneElement {
  return el(id, 'connector', { from, to, ...extra });
}

/** A component in a pattern: drawn as a `node_card` with its title and optional icon. */
export const NodeParamSchema = z.strictObject({
  title: lineText(24, 'Name of the component, shown in uppercase.'),
  icon: AssetIdSchema.optional(),
});
export type NodeParam = z.output<typeof NodeParamSchema>;

export function nodeParam(description: string) {
  return NodeParamSchema.describe(description);
}

/** `node_card` props for a node param, plus any extra props (semantic, role). */
export function nodeProps(node: NodeParam, extra: Record<string, unknown> = {}) {
  return { title: node.title, ...(node.icon ? { icon: node.icon } : {}), ...extra };
}

/** Id of the item at 0-based `index` of a list param: inner target ids count from 1. */
export function nth(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

/** `prefix-1`, `prefix-2`, … for every item of a list param. */
export function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => nth(prefix, i));
}
