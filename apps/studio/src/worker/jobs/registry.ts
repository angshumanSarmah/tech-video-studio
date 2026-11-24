import { directJobHandler, type DirectJobDeps } from './direct.ts';
import { generateJobHandler, type GenerateJobDeps } from './generate.ts';
import type { JobHandler } from './handler.ts';
import { ingestJobHandler, type IngestJobDeps } from './ingest.ts';
import { noopJob } from './noop.ts';
import { renderJobHandlers, type RenderJobDeps } from './render.ts';
import { researchJobHandler, type ResearchJobDeps } from './research.ts';
import { scriptJobHandler, type ScriptJobDeps } from './script.ts';
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
export type WorkerDeps = RenderJobDeps &
  TtsJobDeps &
  IngestJobDeps &
  ResearchJobDeps &
  DirectJobDeps &
  ScriptJobDeps &
  GenerateJobDeps;

/** Every job type the worker runs. Add a handler here; nothing else changes. */
export function createJobHandlers(deps: WorkerDeps): JobHandler[] {
  return [
    noopJob,
    ingestJobHandler(deps),
    researchJobHandler(deps),
    directJobHandler(deps),
    scriptJobHandler(deps),
    generateJobHandler(deps),
    ...renderJobHandlers(deps),
    ttsJobHandler(deps),
  ];
}
