import type { JobHandler } from './handler.ts';
import { noopJob } from './noop.ts';
import { renderJobHandlers, type RenderJobDeps } from './render.ts';
import { ttsJobHandler, type TtsJobDeps } from './tts.ts';

export interface JobRegistry {
  get(type: string): JobHandler | undefined;
  /** Whether a failure of `type` fails its run; unknown types do. */
  failsRun(type: string): boolean;
}

export function createJobRegistry(handlers: readonly JobHandler[]): JobRegistry {
  const byType = new Map<string, JobHandler>();
  for (const handler of handlers) {
    if (byType.has(handler.type)) throw new Error(`Duplicate job handler: ${handler.type}`);
    byType.set(handler.type, handler);
  }
  return {
    get: (type) => byType.get(type),
    failsRun: (type) => byType.get(type)?.failsRun ?? true,
  };
}

/** What handlers need from the worker process (handlers that need nothing ignore it). */
export type WorkerDeps = RenderJobDeps & TtsJobDeps;

/** Every job type the worker runs. Add a handler here; nothing else changes. */
export function createJobHandlers(deps: WorkerDeps): JobHandler[] {
  return [noopJob, ...renderJobHandlers(deps), ttsJobHandler(deps)];
}
