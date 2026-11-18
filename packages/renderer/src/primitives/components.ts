import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { PrimitiveComponentProps } from './component-props.ts';
import { CommandBubble } from './command-bubble/CommandBubble.tsx';
import { CounterTransition } from './counter-transition/CounterTransition.tsx';
import { Counter } from './counter/Counter.tsx';
import { DataBlock } from './data-block/DataBlock.tsx';
import { FormulaCard } from './formula-card/FormulaCard.tsx';
import { Icon } from './icon/Icon.tsx';
import { ItemIcon } from './item-icon/ItemIcon.tsx';
import { NodeCard } from './node-card/NodeCard.tsx';
import { StatCard } from './stat-card/StatCard.tsx';
import { Tag } from './tag/Tag.tsx';
import { TimerRing } from './timer-ring/TimerRing.tsx';
import type { PRIMITIVE_DEFINITIONS, PrimitiveId } from './registry.ts';

type Definition<K extends PrimitiveId> = Extract<(typeof PRIMITIVE_DEFINITIONS)[number], { id: K }>;
type PropsOf<K extends PrimitiveId> = z.output<Definition<K>['propsSchema']>;

/** One component per registered primitive; typecheck fails when one is missing or mistyped. */
const COMPONENTS = {
  tag: Tag,
  node_card: NodeCard,
  icon: Icon,
  item_icon: ItemIcon,
  counter: Counter,
  counter_transition: CounterTransition,
  timer_ring: TimerRing,
  stat_card: StatCard,
  data_block: DataBlock,
  command_bubble: CommandBubble,
  formula_card: FormulaCard,
} satisfies { [K in PrimitiveId]: ComponentType<PrimitiveComponentProps<PropsOf<K>>> };

/** The component for a primitive id. Callers pass props already parsed by its schema. */
export function componentFor(
  id: string,
): ComponentType<PrimitiveComponentProps<unknown>> | undefined {
  return Object.hasOwn(COMPONENTS, id)
    ? (COMPONENTS[id as PrimitiveId] as ComponentType<PrimitiveComponentProps<unknown>>)
    : undefined;
}
