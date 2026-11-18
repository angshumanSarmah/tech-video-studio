import { SpecIdSchema } from '@explainer-studio/shared';
import { counterPrimitive } from './counter/definition.ts';
import { tagPrimitive } from './tag/definition.ts';
import type { AnyPrimitiveDefinition } from './types.ts';

/**
 * Every primitive the renderer knows. Add a primitive by adding its definition here and its
 * component in `components.ts` (typecheck fails until both exist). Catalogues, prompts and
 * validation all read from this list.
 */
export const PRIMITIVE_DEFINITIONS = [tagPrimitive, counterPrimitive] as const;

export type PrimitiveId = (typeof PRIMITIVE_DEFINITIONS)[number]['id'];

export type PrimitiveRegistry = ReadonlyMap<string, AnyPrimitiveDefinition>;

/** Indexes definitions by id; throws on a bad id, a duplicate id, or an example that fails its schema. */
export function buildPrimitiveRegistry(
  definitions: readonly AnyPrimitiveDefinition[],
): PrimitiveRegistry {
  const registry = new Map<string, AnyPrimitiveDefinition>();
  for (const definition of definitions) {
    const { id } = definition;
    if (!SpecIdSchema.safeParse(id).success) throw new Error(`Invalid primitive id "${id}"`);
    if (registry.has(id)) throw new Error(`Duplicate primitive id "${id}"`);
    const example = definition.propsSchema.safeParse(definition.example.props);
    if (!example.success) {
      throw new Error(`Example props of primitive "${id}" are invalid: ${example.error.message}`);
    }
    registry.set(id, definition);
  }
  return registry;
}

export const PRIMITIVES: PrimitiveRegistry = buildPrimitiveRegistry(PRIMITIVE_DEFINITIONS);

export function listPrimitives(): AnyPrimitiveDefinition[] {
  return [...PRIMITIVES.values()];
}

export function getPrimitive(id: string): AnyPrimitiveDefinition | undefined {
  return PRIMITIVES.get(id);
}
