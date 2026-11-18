import { z } from 'zod';
import { listOf } from './common.ts';

export const TOPIC_TITLE_MAX = 200;

export const CreateTopicRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(TOPIC_TITLE_MAX),
  notes: z.string().trim().min(1).optional(),
});
export type CreateTopicRequest = z.infer<typeof CreateTopicRequestSchema>;

export const TopicDtoSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type TopicDto = z.infer<typeof TopicDtoSchema>;

export const TopicListResponseSchema = listOf(TopicDtoSchema);
export type TopicListResponse = z.infer<typeof TopicListResponseSchema>;
