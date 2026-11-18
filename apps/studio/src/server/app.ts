import { Hono } from 'hono';
import { createHealthRoute } from './routes/health.ts';

export interface AppDeps {
  readonly uptimeSeconds: () => number;
}

const defaultDeps: AppDeps = { uptimeSeconds: () => process.uptime() };

/**
 * Builds the HTTP app. Handlers stay thin: validate, read/enqueue, respond.
 * Heavy work (LLM loops, TTS, rendering) belongs to the worker process.
 */
export function createApp(deps: AppDeps = defaultDeps) {
  return new Hono().basePath('/api').route('/health', createHealthRoute(deps.uptimeSeconds));
}

export type App = ReturnType<typeof createApp>;
