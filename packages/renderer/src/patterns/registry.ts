import { SpecIdSchema } from '@explainer-studio/shared';
import { PRIMITIVES, type PrimitiveRegistry } from '../primitives/registry.ts';
import { expansionProblems, undocumentedTargets } from './expansion-checks.ts';
import {
  PATTERN_INSTANCE_ACTIONS,
  type AnyPatternDefinition,
  type PatternExpansion,
} from './types.ts';
import { atomicLockPattern } from './atomic-lock/definition.ts';
import { bruteForceThenIndexPattern } from './brute-force-then-index/definition.ts';
import { cacheHitMissPattern } from './cache-hit-miss/definition.ts';
import { convergeAdapterPattern } from './converge-adapter/definition.ts';
import { failoverPattern } from './failover/definition.ts';
import { fanOutPattern } from './fan-out/definition.ts';
import { floodThenFunnelPattern } from './flood-then-funnel/definition.ts';
import { inferenceCardPattern } from './inference-card/definition.ts';
import { pickByRulePattern } from './pick-by-rule/definition.ts';
import { rejectDuplicatePattern } from './reject-duplicate/definition.ts';
import { splitBrainPattern } from './split-brain/definition.ts';
import { versusSplitPattern } from './versus-split/definition.ts';
import { workerPoolPattern } from './worker-pool/definition.ts';

export { expansionProblems } from './expansion-checks.ts';

/**
 * Every behaviour pattern the renderer knows; add a pattern by adding its definition here.
 * Catalogues, prompts and validation all read from this list.
 */
export const PATTERN_DEFINITIONS: readonly AnyPatternDefinition[] = [
  atomicLockPattern,
  rejectDuplicatePattern,
  fanOutPattern,
  floodThenFunnelPattern,
  convergeAdapterPattern,
  cacheHitMissPattern,
  workerPoolPattern,
  bruteForceThenIndexPattern,
  versusSplitPattern,
  inferenceCardPattern,
  pickByRulePattern,
  failoverPattern,
  splitBrainPattern,
];

export type PatternRegistry = ReadonlyMap<string, AnyPatternDefinition>;

/**
 * Indexes definitions by id. Throws on a bad or duplicate id, instance actions outside
 * `PATTERN_INSTANCE_ACTIONS`, or an example whose params fail the schema or expand badly
 * (`expansionProblems`, events not anchored to `params.at`, undocumented inner targets).
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
    const badActions = definition.actions.filter(
      (a) => !(PATTERN_INSTANCE_ACTIONS as readonly string[]).includes(a),
    );
    if (badActions.length > 0) {
      throw new Error(
        `Pattern "${id}" offers instance actions it must keep: ${badActions.join(', ')}`,
      );
    }
    const params = definition.paramsSchema.safeParse(definition.example.params);
    if (!params.success) {
      throw new Error(`Example params of pattern "${id}" are invalid: ${params.error.message}`);
    }
    const expansion = definition.expand(params.data);
    const problems = [
      ...expansionProblems(expansion, definition.layoutMode, primitives),
      ...unanchoredEvents(expansion, params.data),
      ...undocumentedTargets(expansion, definition.targets).map((t) => `"${t}" is not in targets`),
    ];
    if (problems.length > 0) {
      throw new Error(`Example of pattern "${id}" expands badly: ${problems.join('; ')}`);
    }
    registry.set(id, definition);
  }
  return registry;
}

/** Events whose anchor is not one of `params.at`: every pattern event follows the narration. */
function unanchoredEvents(expansion: PatternExpansion, params: unknown): string[] {
  const at = (params as { at?: Record<string, unknown> }).at ?? {};
  const anchors = new Set(Object.values(at).map((a) => JSON.stringify(a)));
  return expansion.events
    .filter((e) => !anchors.has(JSON.stringify(e.at)))
    .map((e) => `"${e.action}" on ${e.targets.join(', ')} is not anchored to params.at`);
}

export const PATTERNS: PatternRegistry = buildPatternRegistry(PATTERN_DEFINITIONS);

export function listPatterns(): AnyPatternDefinition[] {
  return [...PATTERNS.values()];
}

export function getPattern(id: string): AnyPatternDefinition | undefined {
  return PATTERNS.get(id);
}
