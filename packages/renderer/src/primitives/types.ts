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

export interface PrimitiveDefinition<Id extends string = string, S extends z.ZodType = z.ZodType> {
  id: Id;
  family: PrimitiveFamily;
  /** Validates `props` of a scene element; strict, so unknown props are errors. */
  propsSchema: S;
  /** Event actions this primitive reacts to; any other action targeting it is a spec error. */
  actions: readonly EventAction[];
  /** Method syntax keeps definitions with specific props assignable to the registry's type. */
  sizeHints(props: z.output<S>, theme: Theme): SizeHints;
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
