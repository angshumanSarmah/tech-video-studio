import { MIDDLE_PIN_HOSTS } from '../primitives/common-props.ts';
import type { PrimitiveDefinition } from '../primitives/types.ts';

/**
 * Which pins an element can host (P1C.7): any side of a board element, only the middle of a
 * connector, none on a pattern instance (or the elements inside it), an overlay or another line.
 * From registry data (layer, layout role, the `pin` ref's primitive limit), never id switches.
 */
export type PinHost = 'sides' | 'middle' | 'none';

export function primitivePinHost(definition: PrimitiveDefinition | undefined): PinHost {
  if (!definition || (definition.layer ?? 'board') === 'overlay') return 'none';
  if (definition.layoutRole === 'path') {
    return MIDDLE_PIN_HOSTS.includes(definition.id) ? 'middle' : 'none';
  }
  return 'sides';
}

/** The ON SCREEN wording of a pin host. */
export function pinHostText(host: PinHost): string {
  if (host === 'sides') return 'pins: top, bottom, left, right';
  if (host === 'middle') return 'pins: middle only';
  return 'hosts no pins';
}

export const INSTANCE_PIN_MESSAGE =
  'neither a pattern instance nor the elements inside it can host a pin';

/** Whether a primitive's props take a `pin` (a tag, a counter; not a stat card). */
export function takesPin(definition: PrimitiveDefinition | undefined): boolean {
  const shape = (definition?.propsSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  return shape !== undefined && 'pin' in shape;
}
