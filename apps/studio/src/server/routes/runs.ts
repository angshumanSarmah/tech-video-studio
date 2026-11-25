import {
  CreateRunRequestSchema,
  UpdateRunSettingsRequestSchema,
  type RunSettingsSource,
  IdParamSchema,
  type RunDetailDto,
  type RunDto,
  type RunListResponse,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { getRunSummary, listRuns } from '#core/db/repositories/runs.ts';
import { updateRunSettings } from '#core/services/run-settings.ts';
import { getRunDetail, startRun } from '#core/services/runs.ts';
import { toRunDetailDto, toRunDto } from '../dto.ts';
import { validate } from '../validate.ts';

const RunParamsSchema = z.object({ id: IdParamSchema });

export function createRunsRoute(db: Db, dataDir: string, appSettings: () => RunSettingsSource) {
  return new Hono()
    .get('/', (c) => c.json<RunListResponse>({ items: listRuns(db).map(toRunDto) }))
    .get('/:id', validate('param', RunParamsSchema), (c) => {
      const { id } = c.req.valid('param');
      return c.json<RunDetailDto>(toRunDetailDto(getRunDetail(db, id)));
    })
    .post('/', validate('json', CreateRunRequestSchema), (c) => {
      const { run } = startRun(db, { ...c.req.valid('json'), app: appSettings() });
      return c.json<RunDto>(toRunDto({ ...run, lastError: null }), 201);
    })
    .put(
      '/:id/settings',
      validate('param', RunParamsSchema),
      validate('json', UpdateRunSettingsRequestSchema),
      (c) => {
        const { id } = c.req.valid('param');
        const { settings } = c.req.valid('json');
        updateRunSettings(db, dataDir, {
          runId: id,
          patch: settings,
          priceOf: (model) => appSettings().llm.prices[model],
        });
        return c.json<RunDto>(toRunDto(getRunSummary(db, id)!));
      },
    );
}
