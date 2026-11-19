import {
  EventAnchorSchema,
  type EventAction,
  type SceneElement,
  type SceneEvent,
  type VideoFormat,
} from '@explainer-studio/shared';
import { z } from 'zod';
import type { LayoutModeId } from '../layout/modes.ts';
import type { LlmDescription, PrimitiveFamily } from '../primitives/types.ts';

/**
 * A behaviour pattern: a reusable bit of choreography (e.g. "a second request bounces off a
 * lock") that expands into primitive elements plus timed events. Same shape as a primitive, minus
 * the component and size hints (its elements carry their own), plus the narration moments it needs,
 * its layout mode and `expand`. React-free, like primitive definitions.
 *
 * Conventions every pattern follows:
 * - `params.at` holds one `EventAnchor` per entry in `anchors` (`anchorsSchema` builds it), and
 *   every event the expansion makes is anchored to one of them.
 * - The pattern stages its own `enter`s. Spec events on the instance may only use `actions`
 *   (`PATTERN_INSTANCE_ACTIONS`); on one inner element (`<instance>/<id>`) only
 *   `INNER_TARGET_ACTIONS`. The pattern keeps enter, exit (of inner elements), reject and lock.
 * - Every expanded element sits in a zone of `layoutMode`, except relational ones (those with
 *   element refs: connectors, packet streams, brackets, rings), which follow what they point to.
 */

/** A narration moment the pattern needs; `params.at` takes an `EventAnchor` for each. */
export type PatternAnchor = { name: string; description: string; optional?: boolean };

/**
 * An expanded element that spec events may address as `<instance>/<id>`. `id` may contain a
 * placeholder for list params (`worker-<n>`, counted from 1; `<id>` for an id from the params).
 */
export type PatternTarget = { id: string; description: string };

/**
 * What a pattern instance expands into. Element ids are local to the instance (the renderer
 * namespaces them as `<instance>/<id>`, element refs in props included); events target those
 * local ids.
 */
export type PatternExpansion = { elements: SceneElement[]; events: SceneEvent[] };

/** What a spec event may do to a whole pattern instance (it acts on every element). */
export const PATTERN_INSTANCE_ACTIONS = ['exit', 'highlight', 'dim', 'pulse'] as const;

/** What a spec event may do to one element inside a pattern instance. */
export const INNER_TARGET_ACTIONS: readonly EventAction[] = ['highlight', 'pulse', 'dim'];

export interface PatternDefinition<Id extends string = string, S extends z.ZodType = z.ZodType> {
  id: Id;
  family: PrimitiveFamily;
  /** Validates `params` of a scene pattern, including `at` (one anchor per entry in `anchors`). */
  paramsSchema: S;
  /** Actions a spec event may apply to the whole instance. */
  actions: readonly EventAction[];
  anchors: readonly PatternAnchor[];
  /** The beat's layout mode unless the scene sets its own; expanded zones come from it. */
  layoutMode: LayoutModeId;
  /** Expanded elements spec events may address as `<instance>/<id>`, for the catalogue. */
  targets: readonly PatternTarget[];
  /**
   * Video formats the pattern reads well in (`meta.format`): `full` only when its board falls
   * below the readable scale in the card format's smaller window.
   */
  formats: readonly VideoFormat[];
  /** Narrower formats for some params (e.g. more than 2 workers), described for the catalogue. */
  formatRule?: PatternFormatRule<z.output<S>>;
  description: LlmDescription;
  /** One example usage; its params must parse and expand into valid elements. */
  example: { params: z.input<S> };
  /** Method syntax keeps definitions with specific params assignable to the registry's type. */
  expand(params: z.output<S>): PatternExpansion;
}

export type AnyPatternDefinition = PatternDefinition<string, z.ZodType>;

export type PatternFormatRule<P> = {
  /** When the rule applies, in words for the catalogue, e.g. "more than 2 workers". */
  when: string;
  formats: readonly VideoFormat[];
  /** Method syntax keeps definitions with specific params assignable to the registry's type. */
  applies(params: P): boolean;
};

/** The formats an instance with these (valid) params reads well in. */
export function patternFormats<P>(
  definition: Pick<PatternDefinition, 'formats'> & { formatRule?: PatternFormatRule<P> },
  params: P,
): readonly VideoFormat[] {
  const rule = definition.formatRule;
  return rule?.applies(params) ? rule.formats : definition.formats;
}

/** Identity helper that keeps the literal id and the params type of a definition. */
export function definePattern<const Id extends string, S extends z.ZodType>(
  definition: PatternDefinition<Id, S>,
): PatternDefinition<Id, S> {
  return definition;
}

type AnchorShape<A extends readonly PatternAnchor[]> = {
  [K in A[number] as K['name']]: K extends { optional: true }
    ? z.ZodOptional<typeof EventAnchorSchema>
    : typeof EventAnchorSchema;
};

/** The `params.at` schema for a pattern's declared anchors (optional ones may be left out). */
export function anchorsSchema<const A extends readonly PatternAnchor[]>(
  anchors: A,
): z.ZodObject<AnchorShape<A>, z.core.$strict> {
  const shape = Object.fromEntries(
    anchors.map((a) => {
      const anchor = EventAnchorSchema.describe(a.description);
      return [a.name, a.optional ? anchor.optional() : anchor];
    }),
  );
  return z
    .strictObject(shape)
    .describe('Narration anchors: the word (or beat edge) for each moment.') as never;
}
