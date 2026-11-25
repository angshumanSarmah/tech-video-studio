import { join } from 'node:path';
import { SettingsSchema } from '@explainer-studio/shared';
import type { Db } from '#core/db/client.ts';
import { getJob, type Job } from '#core/db/repositories/jobs.ts';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { analyzeReferenceJobHandler } from '../../jobs/analyze-reference.ts';
import { createJobRegistry } from '../../jobs/registry.ts';
import { createLlmClient } from '../../llm/client.ts';
import { dryRunTransport, type DryRunResponse } from '../../llm/dry-run.ts';
import { runNextJob } from '../../runner.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../prompts/templates.ts';

/** Test-only helpers for the Reference analyst (P1C.11). Not imported by any entrypoint. */

/** The recorded answers (`reference.json`, in slug order of the six seeds), workspace-relative. */
export const REFERENCE_RESPONSES_DIR = 'apps/studio/src/worker/agents/reference/fixtures/responses';

export {
  noSeedReferences,
  savedSeedRecord,
  SEED_SLUGS,
  seedBreakdown,
  seededRecord,
  seedNames,
  seedRecord,
} from '#core/services/references-testing.ts';

const root = findWorkspaceRoot(import.meta.dirname);

export const answer = (value: unknown): DryRunResponse => ({ content: JSON.stringify(value) });

/**
 * Runs queued `analyze_reference` jobs with these answers replayed in order: one transport for
 * every call, so several analyses take their answers (repairs included) from one queue.
 */
export function analysisRunner(
  db: Db,
  dataDir: string,
  answers: readonly DryRunResponse[],
): (jobId: number) => Promise<Job> {
  const llm = createLlmClient({
    db,
    dataDir,
    llm: SettingsSchema.parse({}).llm,
    transport: dryRunTransport({ reference: [...answers] }),
  });
  const prompts = loadPromptTemplates(join(root, PROMPTS_DIR));
  const registry = createJobRegistry([analyzeReferenceJobHandler({ db, dataDir, llm, prompts })]);
  return async (jobId) => {
    await runNextJob({ db, registry, workerId: 'test', signal: new AbortController().signal });
    const job = getJob(db, jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    return job;
  };
}

/** Runs the next queued job (an `analyze_reference`) with these answers replayed. */
export function runAnalysis(
  db: Db,
  dataDir: string,
  jobId: number,
  answers: readonly DryRunResponse[],
): Promise<Job> {
  return analysisRunner(db, dataDir, answers)(jobId);
}
