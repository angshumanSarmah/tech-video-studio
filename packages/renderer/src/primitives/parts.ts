import { SpecIdSchema } from '@explainer-studio/shared';
import { z } from 'zod';

/**
 * `params.parts` on a scene event: the named parts of its single target that the event acts on
 * (a seat in a `slot_grid`, a cell of a `grid_overlay`). React-free: validation and the scene
 * layer both read it.
 */
export const EventPartsSchema = z.array(SpecIdSchema).min(1);

/** The part ids an event names, or undefined when it acts on the whole element. */
export function eventParts(params: Record<string, unknown> | undefined): string[] | undefined {
  const parsed = EventPartsSchema.safeParse(params?.parts);
  return parsed.success ? parsed.data : undefined;
}
