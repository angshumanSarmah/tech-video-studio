import {
  CreateRunRequestSchema,
  IdParamSchema,
  type RunDto,
  type RunListResponse,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { getRun, listRuns } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';
import { startRun } from '#core/services/runs.ts';
import { toRunDto } from '../dto.ts';
import { validate } from '../validate.ts';

const RunParamsSchema = z.object({ id: IdParamSchema });

export function createRunsRoute(db: Db) {
  return new Hono()
    .get('/', (c) => c.json<RunListResponse>({ items: listRuns(db).map(toRunDto) }))
    .get('/:id', validate('param', RunParamsSchema), (c) => {
      const { id } = c.req.valid('param');
      const run = getRun(db, id);
      if (!run) throw new NotFoundError('Run', id);
      return c.json<RunDto>(toRunDto(run));
    })
    .post('/', validate('json', CreateRunRequestSchema), (c) => {
      const { run } = startRun(db, c.req.valid('json'));
      return c.json<RunDto>(toRunDto(run), 201);
    });
}
