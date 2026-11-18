import { SpecIdSchema } from '@explainer-studio/shared';
import { PRIMITIVES, type PrimitiveRegistry } from '../primitives/registry.ts';
import type { AnyPatternDefinition, PatternExpansion } from './types.ts';

/**
 * Every behaviour pattern the renderer knows. Empty until P1A.8; add a pattern by adding its
 * definition here. Catalogues, prompts and validation all read from this list.
 */
export const PATTERN_DEFINITIONS: readonly AnyPatternDefinition[] = [];

export type PatternRegistry = ReadonlyMap<string, AnyPatternDefinition>;

/**
 * Indexes definitions by id. Throws on a bad or duplicate id, an anchor the params don't name, or
 * an example whose params fail the schema or expand into invalid elements.
 */
export function buildPatternRegistry(
  definitions: readonly AnyPatternDefinition[],
  primitives: PrimitiveRegistry = PRIMITIVES,
): PatternRegistry {
  const registry = new Map<string, AnyPatternDefinition>();
  for (const definition of definitions) {
    const { id } = definition;
    if (!SpecIdSchema.safeParse(id).success) throw new Error(`Invalid pattern id "${id}"`);
    if (registry.has(id)) throw new Error(`Duplicate pattern id "${id}"`);
    const params = definition.paramsSchema.safeParse(definition.example.params);
    if (!params.success) {
      throw new Error(`Example params of pattern "${id}" are invalid: ${params.error.message}`);
    }
    const problems = expansionProblems(definition.expand(params.data), primitives);
    if (problems.length > 0) {
      throw new Error(`Example of pattern "${id}" expands badly: ${problems.join('; ')}`);
    }
    registry.set(id, definition);
  }
  return registry;
}

/** Why an expansion is invalid: unknown primitives, bad props, duplicate ids, dangling targets. */
export function expansionProblems(
  expansion: PatternExpansion,
  primitives: PrimitiveRegistry,
): string[] {
  const ids = expansion.elements.map((e) => e.id);
  const known = new Set(ids);
  return [
    ...ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `duplicate element id "${id}"`),
    ...expansion.elements.flatMap((element) => {
      const primitive = primitives.get(element.primitive);
      if (!primitive) return [`unknown primitive "${element.primitive}"`];
      const props = primitive.propsSchema.safeParse(element.props);
      return props.success ? [] : [`invalid props on "${element.id}": ${props.error.message}`];
    }),
    ...expansion.events.flatMap((event) =>
      event.targets.filter((t) => !known.has(t)).map((t) => `event targets unknown "${t}"`),
    ),
  ];
}

export const PATTERNS: PatternRegistry = buildPatternRegistry(PATTERN_DEFINITIONS);

export function listPatterns(): AnyPatternDefinition[] {
  return [...PATTERNS.values()];
}

export function getPattern(id: string): AnyPatternDefinition | undefined {
  return PATTERNS.get(id);
}
