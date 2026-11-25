import type { RunSettingsSource } from '@explainer-studio/shared';
import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { apiError, handleError } from './errors.ts';
import { createDevRoute } from './routes/dev.ts';
import {
  createEventsRoute,
  DEFAULT_EVENT_STREAM_OPTIONS,
  type EventStreamOptions,
} from './routes/events.ts';
import { createGatesRoute } from './routes/gates.ts';
import { createHealthRoute } from './routes/health.ts';
import { createMemoryRoute } from './routes/memory.ts';
import { createRunsRoute } from './routes/runs.ts';
import { createSeriesRoute } from './routes/series.ts';
import { createTopicsRoute } from './routes/topics.ts';
import { mountSpa } from './static.ts';

export interface AppDeps {
  readonly db: Db;
  /** The data dir: gates read and write the run's files (notes, plans, spec versions). */
  readonly dataDir: string;
  /** The app settings as they are now, read when a run starts (its snapshot resolves from them). */
  readonly appSettings: () => RunSettingsSource;
  readonly uptimeSeconds?: () => number;
  /** Built SPA to serve; omitted in dev, where Vite serves it. */
  readonly webDistDir?: string | undefined;
  readonly events?: EventStreamOptions;
  /** Mount `/api/dev` (demo and debug endpoints). Off in the production build. */
  readonly enableDevRoutes?: boolean;
}

function createApi(deps: AppDeps) {
  const api = new Hono()
    .route('/health', createHealthRoute(deps.uptimeSeconds ?? (() => process.uptime())))
    .route('/series', createSeriesRoute(deps.db))
    .route('/topics', createTopicsRoute(deps.db, deps.dataDir))
    .route('/runs', createRunsRoute(deps.db, deps.dataDir, deps.appSettings))
    .route('/runs', createGatesRoute(deps.db, deps.dataDir))
    .route('/memory', createMemoryRoute(deps.db))
    .route('/events', createEventsRoute(deps.db, deps.events ?? DEFAULT_EVENT_STREAM_OPTIONS));
  if (deps.enableDevRoutes) api.route('/dev', createDevRoute(deps.db));
  return api;
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
