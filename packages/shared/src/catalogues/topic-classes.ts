import { z } from 'zod';
import { TOPIC_CLASSES, TopicClassSchema } from '../spec/meta.ts';
import { DeviceIdSchema } from './devices.ts';
import { LayoutModeIdSchema } from './layout-modes.ts';
import { catalogueSchema, CatalogueTextSchema, defineCatalogue, uniqueIds } from './schema.ts';

/**
 * Topic classes (`meta.topicClass`): what kind of topic a video explains, which layout modes its
 * boards may use and which devices usually tell it well. Ids come from `TOPIC_CLASSES`.
 */

export const TopicClassEntrySchema = z.strictObject({
  id: TopicClassSchema,
  name: CatalogueTextSchema,
  summary: CatalogueTextSchema,
  /** Invented, generic topics; never a reference video's product or story. */
  exampleTopics: z.array(CatalogueTextSchema).min(2).max(6),
  /** Layout modes beats of this class may use, most typical first. */
  allowedLayoutModes: uniqueIds(LayoutModeIdSchema),
  /** Devices that usually tell this class well, best first. Others stay allowed. */
  preferredDevices: uniqueIds(DeviceIdSchema),
});
export type TopicClassEntry = z.infer<typeof TopicClassEntrySchema>;

export const TopicClassCatalogueSchema = catalogueSchema(
  'topic-classes',
  TOPIC_CLASSES,
  TopicClassEntrySchema,
);

export const TOPIC_CLASS_CATALOGUE = defineCatalogue(TopicClassCatalogueSchema, {
  id: 'topic-classes',
  version: 1,
  entries: [
    {
      id: 'product-design',
      name: 'Product design',
      summary:
        'How a user-facing feature works end to end: requests through services, places, stock and time.',
      exampleTopics: ['URL shortener', 'ride matching', 'seat booking', 'delivery ETA'],
      allowedLayoutModes: [
        'map',
        'pipeline',
        'hub_spoke',
        'grid',
        'swimlane',
        'centered_focus',
        'versus_split',
        'near_far',
        'two_column',
        'stacked_list',
      ],
      preferredDevices: [
        'persona_hook',
        'contention_hook',
        'hero_metric',
        'object_to_data',
        'failure_before_fix',
        'named_traps',
        'seen_this_bug',
        'ownership_twist',
        'race_reveal',
        'real_world_closure',
        'callback_ending',
      ],
    },
    {
      id: 'internals',
      name: 'Internals',
      summary:
        'How one piece of infrastructure works inside: its data structures, storage and request path.',
      exampleTopics: ['how a key-value store keeps keys', 'database indexes', 'log partitions'],
      allowedLayoutModes: [
        'centered_focus',
        'stacked_list',
        'versus_split',
        'pipeline',
        'grid',
        'swimlane',
        'two_column',
        'hub_spoke',
        'near_far',
        'cycle',
      ],
      preferredDevices: [
        'semantic_zoom',
        'question_chapters',
        'what_breaks',
        'versus_split',
        'brute_force_first',
        'planted_question',
        'interview_hook',
        'real_incident',
      ],
    },
    {
      id: 'concept',
      name: 'Concept',
      summary: 'One idea that recurs across systems, shown on one small concrete example.',
      exampleTopics: ['caching', 'consistent hashing', 'idempotency', 'rate limiting'],
      allowedLayoutModes: [
        'near_far',
        'versus_split',
        'cycle',
        'grid',
        'centered_focus',
        'pipeline',
        'hub_spoke',
        'two_column',
        'stacked_list',
        'swimlane',
      ],
      preferredDevices: [
        'failure_before_fix',
        'brute_force_first',
        'versus_split',
        'what_breaks',
        'seen_this_bug',
        'counterfactual',
        'contrast_takeaway',
        'real_incident',
        'interview_hook',
      ],
    },
    {
      id: 'ai-ml',
      name: 'AI and ML',
      summary:
        'How a model or AI system works: what goes in, what it computes, why the output looks that way.',
      exampleTopics: ['tokenization', 'retrieval-augmented generation', 'KV cache', 'embeddings'],
      allowedLayoutModes: [
        'pipeline',
        'cycle',
        'versus_split',
        'centered_focus',
        'stacked_list',
        'two_column',
        'grid',
        'hub_spoke',
        'near_far',
      ],
      preferredDevices: [
        'object_to_data',
        'planted_question',
        'what_breaks',
        'brute_force_first',
        'versus_split',
        'semantic_zoom',
        'question_chapters',
        'counterfactual',
        'seen_this_bug',
      ],
    },
  ],
});
