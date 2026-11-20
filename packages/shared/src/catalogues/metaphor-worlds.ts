import { z } from 'zod';
import {
  catalogueSchema,
  CatalogueTextSchema,
  defineCatalogue,
  DescribedFieldsSchema,
} from './schema.ts';

/**
 * Metaphor worlds: an optional everyday setting a whole video can borrow (`story.metaphorWorld`),
 * with the engineering concepts it maps cleanly. Use one world per video, or none.
 */

export const METAPHOR_WORLD_IDS = [
  'traffic',
  'kitchen',
  'library',
  'factory',
  'post_office',
  'detective_office',
  'star_map',
] as const;
export const MetaphorWorldIdSchema = z.enum(METAPHOR_WORLD_IDS);
export type MetaphorWorldId = z.infer<typeof MetaphorWorldIdSchema>;

export const ConceptMappingSchema = z.strictObject({
  /** The engineering concept, e.g. "queue". */
  concept: CatalogueTextSchema,
  /** What stands for it in the world, e.g. "line of cars at a signal". */
  metaphor: CatalogueTextSchema,
});
export type ConceptMapping = z.infer<typeof ConceptMappingSchema>;

export const MetaphorWorldEntrySchema = DescribedFieldsSchema.extend({
  id: MetaphorWorldIdSchema,
  mappings: z
    .array(ConceptMappingSchema)
    .min(4)
    .refine((ms) => new Set(ms.map((m) => m.concept)).size === ms.length, 'Map each concept once.'),
});
export type MetaphorWorldEntry = z.infer<typeof MetaphorWorldEntrySchema>;

export const MetaphorWorldCatalogueSchema = catalogueSchema(
  'metaphor-worlds',
  METAPHOR_WORLD_IDS,
  MetaphorWorldEntrySchema,
);

export const METAPHOR_WORLD_CATALOGUE = defineCatalogue(MetaphorWorldCatalogueSchema, {
  id: 'metaphor-worlds',
  version: 1,
  entries: [
    {
      id: 'traffic',
      name: 'Traffic',
      summary: 'Roads, junctions and toll gates: requests as cars competing for lanes.',
      whenToUse: 'Load, throttling, routing and congestion.',
      whenNotToUse: 'Storage or data layout, where nothing moves.',
      mappings: [
        { concept: 'request', metaphor: 'car' },
        { concept: 'server capacity', metaphor: 'lanes on a road' },
        { concept: 'load balancer', metaphor: 'officer directing a junction' },
        { concept: 'rate limit', metaphor: 'toll gate letting a fixed number through per minute' },
        { concept: 'queue', metaphor: 'line of cars at a signal' },
        { concept: 'overload', metaphor: 'traffic jam' },
        { concept: 'retry with backoff', metaphor: 'driver waiting longer before trying again' },
      ],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      summary: 'A restaurant kitchen: orders as tickets, cooks as workers, the pantry as storage.',
      whenToUse: 'Work queues, worker pools, batching, caching prepared results.',
      whenNotToUse: 'Networks spread over distance; nothing in a kitchen is far away.',
      mappings: [
        { concept: 'request', metaphor: 'order ticket' },
        { concept: 'worker', metaphor: 'cook' },
        { concept: 'queue', metaphor: 'ticket rail' },
        { concept: 'cache', metaphor: 'prepped ingredients on the counter' },
        { concept: 'database', metaphor: 'walk-in pantry' },
        { concept: 'batching', metaphor: 'cooking several orders in one pan' },
        { concept: 'timeout', metaphor: 'a dish sent back cold' },
      ],
    },
    {
      id: 'library',
      name: 'Library',
      summary: 'Shelves, catalogues and branches: data as books, lookups as finding a shelf.',
      whenToUse: 'Indexes, caches, sharding, replication and lookups.',
      whenNotToUse: 'Real-time flows where order and timing are the point.',
      mappings: [
        { concept: 'record', metaphor: 'book' },
        { concept: 'index', metaphor: 'card catalogue' },
        { concept: 'full scan', metaphor: 'walking every aisle' },
        { concept: 'cache', metaphor: 'books kept on the front desk' },
        { concept: 'shard', metaphor: 'a separate branch holding some of the books' },
        { concept: 'replica', metaphor: 'a copy of a book in another branch' },
        { concept: 'eviction', metaphor: 'least-borrowed books sent to storage' },
      ],
    },
    {
      id: 'factory',
      name: 'Factory',
      summary: 'Conveyors and workstations: data as items moving through stages.',
      whenToUse: 'Pipelines, stream processing, backpressure and throughput.',
      whenNotToUse: 'Single lookups with no stages.',
      mappings: [
        { concept: 'pipeline stage', metaphor: 'workstation' },
        { concept: 'message', metaphor: 'item on the conveyor' },
        { concept: 'worker pool', metaphor: 'workers sharing one station' },
        { concept: 'backpressure', metaphor: 'conveyor stopping when packing is full' },
        { concept: 'batch', metaphor: 'crate of items' },
        { concept: 'failed job', metaphor: 'item pulled off the line for inspection' },
      ],
    },
    {
      id: 'post_office',
      name: 'Post office',
      summary: 'Letters, sorting offices and postcodes: messages routed to their readers.',
      whenToUse: 'Message brokers, pub/sub, delivery guarantees and routing.',
      whenNotToUse: 'Synchronous calls where the caller waits for the answer.',
      mappings: [
        { concept: 'message', metaphor: 'letter' },
        { concept: 'broker', metaphor: 'sorting office' },
        { concept: 'partition', metaphor: 'sorting bin' },
        { concept: 'routing key', metaphor: 'postcode' },
        { concept: 'at-least-once delivery', metaphor: 'registered mail resent until signed for' },
        { concept: 'dead-letter queue', metaphor: 'shelf for undeliverable mail' },
        { concept: 'publish-subscribe', metaphor: 'newsletter posted to every subscriber' },
      ],
    },
    {
      id: 'detective_office',
      name: 'Detective office',
      summary: 'Evidence boards and witness statements: debugging as an investigation.',
      whenToUse: 'Observability, logs, traces, root-cause analysis and incidents.',
      whenNotToUse: 'Explaining how a system works when nothing has gone wrong.',
      mappings: [
        { concept: 'log line', metaphor: 'witness statement' },
        { concept: 'trace', metaphor: "map of the suspect's movements" },
        { concept: 'metrics dashboard', metaphor: 'evidence board' },
        { concept: 'alert', metaphor: 'tip-off call' },
        { concept: 'hypothesis', metaphor: 'suspect' },
        { concept: 'root cause', metaphor: 'culprit' },
      ],
    },
    {
      id: 'star_map',
      name: 'Star map',
      summary: 'A night sky of points: meaning as position, similarity as distance.',
      whenToUse: 'Embeddings, vector search, clustering and nearest neighbours.',
      whenNotToUse: 'Anything without a notion of distance between items.',
      mappings: [
        { concept: 'embedding', metaphor: "a star's position" },
        { concept: 'vector space', metaphor: 'the night sky' },
        { concept: 'similarity', metaphor: 'distance between stars' },
        { concept: 'nearest-neighbour search', metaphor: 'finding the closest stars to a point' },
        { concept: 'cluster', metaphor: 'constellation' },
        { concept: 'query', metaphor: 'a new point of light' },
      ],
    },
  ],
});
