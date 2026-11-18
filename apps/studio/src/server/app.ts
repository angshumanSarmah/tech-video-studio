import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { apiError, handleError } from './errors.ts';
import {
  createEventsRoute,
  DEFAULT_EVENT_STREAM_OPTIONS,
  type EventStreamOptions,
} from './routes/events.ts';
import { createHealthRoute } from './routes/health.ts';
import { createRunsRoute } from './routes/runs.ts';
import { createSeriesRoute } from './routes/series.ts';
import { createTopicsRoute } from './routes/topics.ts';
import { mountSpa } from './static.ts';

export interface AppDeps {
  readonly db: Db;
  readonly uptimeSeconds?: () => number;
  /** Built SPA to serve; omitted in dev, where Vite serves it. */
  readonly webDistDir?: string | undefined;
  readonly events?: EventStreamOptions;
}

function createApi(deps: AppDeps) {
  return new Hono()
    .route('/health', createHealthRoute(deps.uptimeSeconds ?? (() => process.uptime())))
    .route('/series', createSeriesRoute(deps.db))
    .route('/topics', createTopicsRoute(deps.db))
    .route('/runs', createRunsRoute(deps.db))
    .route('/events', createEventsRoute(deps.db, deps.events ?? DEFAULT_EVENT_STREAM_OPTIONS));
}

/**
 * Builds the HTTP app. Handlers stay thin: validate, call core, respond.
 * Heavy work (LLM loops, TTS, rendering) belongs to the worker process.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono().route('/api', createApi(deps));
  app.all('/api/*', (c) =>
    apiError(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}`),
  );
  if (deps.webDistDir) mountSpa(app, deps.webDistDir);
  app.onError(handleError);
  return app;
}

export type App = ReturnType<typeof createApp>;
