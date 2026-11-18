import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { PrimitiveComponentProps } from './component-props.ts';
import { Counter } from './counter/Counter.tsx';
import { Tag } from './tag/Tag.tsx';
import type { PRIMITIVE_DEFINITIONS, PrimitiveId } from './registry.ts';

type Definition<K extends PrimitiveId> = Extract<(typeof PRIMITIVE_DEFINITIONS)[number], { id: K }>;
type PropsOf<K extends PrimitiveId> = z.output<Definition<K>['propsSchema']>;

/** One component per registered primitive; typecheck fails when one is missing or mistyped. */
const COMPONENTS = {
  tag: Tag,
  counter: Counter,
} satisfies { [K in PrimitiveId]: ComponentType<PrimitiveComponentProps<PropsOf<K>>> };

/** The component for a primitive id. Callers pass props already parsed by its schema. */
export function componentFor(
  id: string,
): ComponentType<PrimitiveComponentProps<unknown>> | undefined {
  return Object.hasOwn(COMPONENTS, id)
    ? (COMPONENTS[id as PrimitiveId] as ComponentType<PrimitiveComponentProps<unknown>>)
    : undefined;
}
