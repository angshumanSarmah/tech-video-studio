import {
  AddSourceRequestSchema,
  CreateTopicRequestSchema,
  IdParamSchema,
  MAX_SOURCE_BYTES,
  type SourceDto,
  type SourceListResponse,
  type TopicDto,
  type TopicListResponse,
} from '@explainer-studio/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { createTopic, listTopics } from '#core/db/repositories/topics.ts';
import { InvalidSourceError } from '#core/errors.ts';
import { addSource, listSources, uploadSource } from '#core/services/sources.ts';
import { toSourceDto, toTopicDto } from '../dto.ts';
import { apiError, validationError } from '../errors.ts';
import { validate } from '../validate.ts';

const TopicParamsSchema = z.object({ id: IdParamSchema });

/** A multipart upload carries its file plus form overhead. */
const MAX_BODY_BYTES = MAX_SOURCE_BYTES + 64 * 1024;

export function createTopicsRoute(db: Db, dataDir: string) {
  return (
    new Hono()
      .get('/', (c) => c.json<TopicListResponse>({ items: listTopics(db).map(toTopicDto) }))
      .post('/', validate('json', CreateTopicRequestSchema), (c) =>
        c.json<TopicDto>(toTopicDto(createTopic(db, c.req.valid('json'))), 201),
      )
      .get('/:id/sources', validate('param', TopicParamsSchema), (c) => {
        const { id } = c.req.valid('param');
        return c.json<SourceListResponse>({ items: listSources(db, id).map(toSourceDto) });
      })
      /**
       * A URL or pasted text as JSON (`AddSourceRequestSchema`), or a file as multipart form data
       * (field `file`: .md, .txt, .pdf, .docx, .csv or .json).
       */
      .post(
        '/:id/sources',
        validate('param', TopicParamsSchema),
        bodyLimit({
          maxSize: MAX_BODY_BYTES,
          onError: (c) => apiError(c, 400, 'bad_request', 'The upload is larger than 15 MB.'),
        }),
        async (c) => {
          const { id } = c.req.valid('param');
          const source = isMultipart(c)
            ? await addUpload(c, db, dataDir, id)
            : await addFromJson(c, db, dataDir, id);
          return source instanceof Response ? source : c.json<SourceDto>(toSourceDto(source), 201);
        },
      )
  );
}

function isMultipart(c: Context): boolean {
  return (c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data');
}

async function addFromJson(c: Context, db: Db, dataDir: string, topicId: number) {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = AddSourceRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(c, parsed.error);
  return addSource(db, dataDir, topicId, parsed.data);
}

async function addUpload(c: Context, db: Db, dataDir: string, topicId: number) {
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) {
    throw new InvalidSourceError('Send the file as multipart form data in the field "file".');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return uploadSource(db, dataDir, topicId, { name: file.name, bytes });
}
