import type { EventAction } from '@explainer-studio/shared';
import type { z } from 'zod';
import type { Theme } from '../theme/index.ts';

/**
 * Primitive definitions are React-free: the worker and server import them (through
 * `@explainer-studio/renderer/catalog`) for validation and prompts. Components live beside them
 * and are wired up in `components.ts`.
 */

export const PRIMITIVE_FAMILIES = [
  'annotation',
  'data',
  'spatial',
  'flow',
  'metric',
  'object',
  'ml',
] as const;
export type PrimitiveFamily = (typeof PRIMITIVE_FAMILIES)[number];

/** LLM-facing text. Plain sentences; the catalogue renders them into prompts and docs. */
export type LlmDescription = {
  /** One paragraph: what it looks like and what it shows. */
  summary: string;
  whenToUse: string;
  whenNotToUse: string;
};

/**
 * Intrinsic size in canvas px for the layout engine. Text cannot shrink below `min`; the layout
 * engine may grow an element up to the space its mode gives it.
 */
export type SizeHints = {
  minWidth: number;
  minHeight: number;
  preferredWidth: number;
  preferredHeight: number;
};

export type Size = { width: number; height: number };

/** An asset id a primitive's props reference, with its path inside `props`. */
export type AssetRef = { path: (string | number)[]; id: string };

/**
 * Another element a primitive's props point to (`connector.from`), with its path inside `props`.
 * Validation checks that the id is in the beat's scope and, when `primitives` is given, that it is
 * one of those primitives. The layout engine (P1A.9) resolves it to geometry.
 */
export type ElementRef = { path: (string | number)[]; id: string; primitives?: readonly string[] };

/**
 * Named parts of an element (slots, cells, zones) that an event can address on its own with
 * `params.parts`. Part events drive `ElementState.parts`; element events still act on the whole.
 */
export type PartsDefinition<P> = {
  /** Actions an event naming parts may use; any other is a spec error. */
  actions: readonly EventAction[];
  /** Part ids in the props, in display order. */
  ids(props: P): string[];
};

export interface PrimitiveDefinition<Id extends string = string, S extends z.ZodType = z.ZodType> {
  id: Id;
  family: PrimitiveFamily;
  /** Validates `props` of a scene element; strict, so unknown props are errors. */
  propsSchema: S;
  /** Event actions this primitive reacts to; any other action targeting it is a spec error. */
  actions: readonly EventAction[];
  /** Method syntax keeps definitions with specific props assignable to the registry's type. */
  sizeHints(props: z.output<S>, theme: Theme): SizeHints;
  /** Asset ids in the props, for `unknown_asset` warnings. Omit when the primitive uses none. */
  assetRefs?(props: z.output<S>): AssetRef[];
  /** Other elements the props point to. Omit when the primitive stands alone. */
  elementRefs?(props: z.output<S>): ElementRef[];
  /** Parts events can address with `params.parts`. Omit when the element acts only as a whole. */
  parts?: PartsDefinition<z.output<S>>;
  description: LlmDescription;
  /** One example usage; its props must parse (checked when the registry is built). */
  example: { props: z.input<S> };
}

export type AnyPrimitiveDefinition = PrimitiveDefinition<string, z.ZodType>;

/** Identity helper that keeps the literal id and the props type of a definition. */
export function definePrimitive<const Id extends string, S extends z.ZodType>(
  definition: PrimitiveDefinition<Id, S>,
): PrimitiveDefinition<Id, S> {
  return definition;
}
