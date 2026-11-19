import { z } from 'zod';

/**
 * Event params the engine reads (besides `parts`, see `primitives/parts.ts`). Validation checks
 * them (`eventParamErrors`), and the catalogue documents them. React-free.
 */

export const STAGGER_MODES = ['scan'] as const;

export const EventEngineParamsSchema = z.looseObject({
  hold: z
    .boolean()
    .optional()
    .describe(
      'highlight only: keep the highlight on past the next focus change or beat (until a later ' +
        'dim, exit or reject).',
    ),
  stagger: z
    .enum(STAGGER_MODES)
    .optional()
    .describe(
      'scan: a deliberate one-by-one sweep over the targets (or the parts, in the element’s own ' +
        'order), about 0.15 s apart, at most 2 s and never past the beat’s next event.',
    ),
});

export type StaggerMode = (typeof STAGGER_MODES)[number];

/** True when the event keeps its highlight held (no automatic clear). */
export function eventHolds(params: Record<string, unknown> | undefined): boolean {
  return params?.hold === true;
}

/** The event's stagger mode; `default` unless it asks for a scan. */
export function eventStagger(params: Record<string, unknown> | undefined): StaggerMode | 'default' {
  return params?.stagger === 'scan' ? 'scan' : 'default';
}
