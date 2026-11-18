import {
  CreateTopicRequestSchema,
  type TopicDto,
  type TopicListResponse,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { createTopic, listTopics } from '#core/db/repositories/topics.ts';
import { toTopicDto } from '../dto.ts';
import { validate } from '../validate.ts';

export function createTopicsRoute(db: Db) {
  return new Hono()
    .get('/', (c) => c.json<TopicListResponse>({ items: listTopics(db).map(toTopicDto) }))
    .post('/', validate('json', CreateTopicRequestSchema), (c) =>
      c.json<TopicDto>(toTopicDto(createTopic(db, c.req.valid('json'))), 201),
    );
}
