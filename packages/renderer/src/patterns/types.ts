import type { EventAction, SceneElement, SceneEvent } from '@explainer-studio/shared';
import type { z } from 'zod';
import type { LlmDescription, PrimitiveFamily } from '../primitives/types.ts';

/**
 * A behaviour pattern: a reusable bit of choreography (e.g. "a second request bounces off a
 * lock") that expands into primitive elements plus timed events. Same shape as a primitive, minus
 * the component and size hints (its elements carry their own), plus the narration moments it needs
 * and `expand`. React-free, like primitive definitions.
 */

/** A narration moment the pattern needs; `paramsSchema` takes an `EventAnchor` for each. */
export type PatternAnchor = { name: string; description: string };

/**
 * What a pattern instance expands into. Element ids are local to the instance (the renderer
 * namespaces them); events target those local ids. How spec events and focus can address the
 * parts is open (see docs/TODO.md, P1A.8).
 */
export type PatternExpansion = { elements: SceneElement[]; events: SceneEvent[] };

export interface PatternDefinition<Id extends string = string, S extends z.ZodType = z.ZodType> {
  id: Id;
  family: PrimitiveFamily;
  /** Validates `params` of a scene pattern, including one anchor per entry in `anchors`. */
  paramsSchema: S;
  /** Actions a spec event may apply to the whole instance. */
  actions: readonly EventAction[];
  anchors: readonly PatternAnchor[];
  description: LlmDescription;
  /** One example usage; its params must parse and expand into valid elements. */
  example: { params: z.input<S> };
  /** Method syntax keeps definitions with specific params assignable to the registry's type. */
  expand(params: z.output<S>): PatternExpansion;
}

export type AnyPatternDefinition = PatternDefinition<string, z.ZodType>;

/** Identity helper that keeps the literal id and the params type of a definition. */
export function definePattern<const Id extends string, S extends z.ZodType>(
  definition: PatternDefinition<Id, S>,
): PatternDefinition<Id, S> {
  return definition;
}
