import {
  DirectorInputSchema,
  DirectorPlanSchema,
  type DirectorInput,
  type DirectorPlan,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { latestDoneStep, type RunStep } from '../db/repositories/run-steps.ts';

export interface RunDirection {
  readonly step: RunStep;
  readonly plan: DirectorPlan;
  /** What the step read (the research step it used, memory, settings). */
  readonly input: DirectorInput;
}

/**
 * Gate 2's input: the plan of the run's newest finished Director step and what it read, both
 * validated (the files can be edited on disk). Undefined until a Director step has finished.
 */
export function latestDirection(
  db: Executor,
  dataDir: string,
  runId: number,
): RunDirection | undefined {
  const step = latestDoneStep(db, runId, 'direct');
  if (!step?.outputPath || !step.inputPath) return undefined;
  return {
    step,
    plan: DirectorPlanSchema.parse(readDataJson(dataDir, step.outputPath)),
    input: DirectorInputSchema.parse(readDataJson(dataDir, step.inputPath)),
  };
}
