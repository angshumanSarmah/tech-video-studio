import type { SeriesListResponse } from '@explainer-studio/shared';
import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { toSeriesDto } from '../dto.ts';

export function createSeriesRoute(db: Db) {
  return new Hono().get('/', (c) =>
    c.json<SeriesListResponse>({ items: listSeries(db).map(toSeriesDto) }),
  );
}
