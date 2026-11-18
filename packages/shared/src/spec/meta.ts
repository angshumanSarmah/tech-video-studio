import { z } from 'zod';
import { SHORT_LENGTH_SEC } from '../domain/run.ts';
import { SpecIdSchema } from './ids.ts';

export const TOPIC_CLASSES = ['product-design', 'internals', 'concept', 'ai-ml'] as const;
export const TopicClassSchema = z.enum(TOPIC_CLASSES);
export type TopicClass = z.infer<typeof TopicClassSchema>;

export const MetaSchema = z.strictObject({
  id: SpecIdSchema,
  /** Series tag (`series.tag`). */
  series: SpecIdSchema,
  title: z.string().min(1),
  topicClass: TopicClassSchema,
  targetLengthSec: z.number().int().min(SHORT_LENGTH_SEC.min).max(SHORT_LENGTH_SEC.max),
});
export type Meta = z.infer<typeof MetaSchema>;
