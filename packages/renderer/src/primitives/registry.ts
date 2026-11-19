import { SpecIdSchema } from '@explainer-studio/shared';
import { bracketPrimitive } from './bracket/definition.ts';
import { calloutPrimitive } from './callout/definition.ts';
import { commandBubblePrimitive } from './command-bubble/definition.ts';
import { connectorPrimitive } from './connector/definition.ts';
import { conveyorQueuePrimitive } from './conveyor-queue/definition.ts';
import { counterTransitionPrimitive } from './counter-transition/definition.ts';
import { counterPrimitive } from './counter/definition.ts';
import { dataBlockPrimitive } from './data-block/definition.ts';
import { deviceFramePrimitive } from './device-frame/definition.ts';
import { formulaCardPrimitive } from './formula-card/definition.ts';
import { gridOverlayPrimitive } from './grid-overlay/definition.ts';
import { iconPrimitive } from './icon/definition.ts';
import { insetPanelPrimitive } from './inset-panel/definition.ts';
import { itemIconPrimitive } from './item-icon/definition.ts';
import { mapBasePrimitive } from './map-base/definition.ts';
import { nodeCardPrimitive } from './node-card/definition.ts';
import { packetStreamPrimitive } from './packet-stream/definition.ts';
import { radiusRingPrimitive } from './radius-ring/definition.ts';
import { routePathPrimitive } from './route-path/definition.ts';
import { segmentedTimeBarPrimitive } from './segmented-time-bar/definition.ts';
import { slotGridPrimitive } from './slot-grid/definition.ts';
import { statCardPrimitive } from './stat-card/definition.ts';
import { statementCardPrimitive } from './statement-card/definition.ts';
import { tagPrimitive } from './tag/definition.ts';
import { timerRingPrimitive } from './timer-ring/definition.ts';
import { zonePolygonPrimitive } from './zone-polygon/definition.ts';
import type { AnyPrimitiveDefinition } from './types.ts';

/**
 * Every primitive the renderer knows. Add a primitive by adding its definition here and its
 * component in `components.ts` (typecheck fails until both exist). Catalogues, prompts and
 * validation all read from this list.
 */
export const PRIMITIVE_DEFINITIONS = [
  tagPrimitive,
  nodeCardPrimitive,
  iconPrimitive,
  itemIconPrimitive,
  counterPrimitive,
  counterTransitionPrimitive,
  timerRingPrimitive,
  statCardPrimitive,
  dataBlockPrimitive,
  commandBubblePrimitive,
  formulaCardPrimitive,
  connectorPrimitive,
  routePathPrimitive,
  packetStreamPrimitive,
  conveyorQueuePrimitive,
  zonePolygonPrimitive,
  gridOverlayPrimitive,
  slotGridPrimitive,
  segmentedTimeBarPrimitive,
  mapBasePrimitive,
  insetPanelPrimitive,
  bracketPrimitive,
  calloutPrimitive,
  deviceFramePrimitive,
  radiusRingPrimitive,
  statementCardPrimitive,
] as const;

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
