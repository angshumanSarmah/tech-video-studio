import { z } from 'zod';
import { SpecIdSchema } from '../spec/ids.ts';
import { catalogueSchema, CatalogueTextSchema, defineCatalogue } from './schema.ts';

/**
 * Layout modes as data: ids, zones, capacity and LLM-facing text. The renderer's layout engine
 * (`packages/renderer/src/layout/modes.ts`) adds each mode's placement behaviour and fails to
 * typecheck when a mode has none, so this list is the single source of mode ids.
 */

export const LAYOUT_MODE_IDS = [
  'map',
  'two_column',
  'grid',
  'stacked_list',
  'centered_focus',
  'pipeline',
  'cycle',
  'swimlane',
  'versus_split',
  'near_far',
  'hub_spoke',
] as const;
export const LayoutModeIdSchema = z.enum(LAYOUT_MODE_IDS);
export type LayoutModeId = z.infer<typeof LayoutModeIdSchema>;

export const LayoutModeEntrySchema = z.strictObject({
  id: LayoutModeIdSchema,
  /** Zone names elements may use (`SceneElement.zone`), in reading order. */
  zones: z
    .array(SpecIdSchema)
    .min(1)
    .refine((zones) => new Set(zones).size === zones.length, 'List each zone once.'),
  /** Most units (elements with their pins; asides not counted) the mode reads well with. */
  maxUnits: z.number().int().positive(),
  summary: CatalogueTextSchema,
  whenToUse: CatalogueTextSchema,
});
export type LayoutModeEntry = z.infer<typeof LayoutModeEntrySchema>;

export const LayoutModeCatalogueSchema = catalogueSchema(
  'layout-modes',
  LAYOUT_MODE_IDS,
  LayoutModeEntrySchema,
);

export const LAYOUT_MODE_CATALOGUE = defineCatalogue(LayoutModeCatalogueSchema, {
  id: 'layout-modes',
  version: 1,
  entries: [
    {
      id: 'map',
      zones: ['base', 'overlay', 'marker', 'aside'],
      maxUnits: 6,
      summary: 'A map base filling the stage, overlays sharing its frame, markers on top.',
      whenToUse: 'Places, distance or territory matter: riders, zones, regions, data centres.',
    },
    {
      id: 'two_column',
      zones: ['left', 'right', 'aside'],
      maxUnits: 8,
      summary: 'Two columns of elements, read left then right.',
      whenToUse: 'Two related groups read in order, such as inputs then outputs.',
    },
    {
      id: 'grid',
      zones: ['cell', 'aside'],
      maxUnits: 12,
      summary: 'Equal elements in a grid of cells.',
      whenToUse: 'Many equal items: shards, buckets, slots, replicas.',
    },
    {
      id: 'stacked_list',
      zones: ['row', 'aside'],
      maxUnits: 6,
      summary: 'Elements stacked top to bottom as rows.',
      whenToUse: 'An ordered list or stack: layers, log entries, ranked results.',
    },
    {
      id: 'centered_focus',
      zones: ['center', 'around', 'aside'],
      maxUnits: 7,
      summary: 'One focus element in the middle, the rest smaller around it.',
      whenToUse: 'One thing is the subject and the rest is context. The default when nothing fits.',
    },
    {
      id: 'pipeline',
      zones: ['source', 'stage', 'sink', 'aside'],
      maxUnits: 10,
      summary: 'Stages in flow order (top-down or left-right): sources, middle stages, sinks.',
      whenToUse:
        'Something moves through stages in order: a request path, a data or model pipeline.',
    },
    {
      id: 'cycle',
      zones: ['ring', 'center', 'aside'],
      maxUnits: 8,
      summary: 'Steps on a ring that loops back to the start, an optional element in the middle.',
      whenToUse: 'A loop that repeats: retries, a training step, an agent calling tools in turn.',
    },
    {
      id: 'swimlane',
      zones: ['lane-1', 'lane-2', 'lane-3', 'lane-4', 'message', 'aside'],
      maxUnits: 12,
      summary: 'Vertical lanes, one per actor, with ordered messages between them.',
      whenToUse: 'Two to four actors exchange messages over time: a handshake, a protocol, a race.',
    },
    {
      id: 'versus_split',
      zones: ['left', 'right', 'shared'],
      maxUnits: 8,
      summary: 'Two halves side by side for the same situation; shared elements span both.',
      whenToUse: 'Two options or two outcomes for the same input, compared side by side.',
    },
    {
      id: 'near_far',
      zones: ['origin', 'near', 'far', 'aside'],
      maxUnits: 5,
      summary: 'An origin with a near and a far destination, the distance drawn to scale.',
      whenToUse: 'The cost is distance or latency: a nearby cache versus a far database.',
    },
    {
      id: 'hub_spoke',
      zones: ['hub', 'spoke', 'aside'],
      maxUnits: 9,
      summary: 'One hub in the middle with spokes around it.',
      whenToUse: 'One central thing serves or coordinates many: a broker, a coordinator, a lock.',
    },
  ],
});
