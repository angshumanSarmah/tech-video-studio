import {
  CreateRunRequestSchema,
  IdParamSchema,
  type RunDetailDto,
  type RunDto,
  type RunListResponse,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { listRuns } from '#core/db/repositories/runs.ts';
import { getRunDetail, startRun } from '#core/services/runs.ts';
import { toRunDetailDto, toRunDto } from '../dto.ts';
import { validate } from '../validate.ts';

const RunParamsSchema = z.object({ id: IdParamSchema });

export function createRunsRoute(db: Db) {
  return new Hono()
    .get('/', (c) => c.json<RunListResponse>({ items: listRuns(db).map(toRunDto) }))
    .get('/:id', validate('param', RunParamsSchema), (c) => {
      const { id } = c.req.valid('param');
      return c.json<RunDetailDto>(toRunDetailDto(getRunDetail(db, id)));
    })
    .post('/', validate('json', CreateRunRequestSchema), (c) => {
      const { run } = startRun(db, c.req.valid('json'));
      return c.json<RunDto>(toRunDto(run), 201);
    });
}
