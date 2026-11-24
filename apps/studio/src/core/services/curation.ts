import {
  CurateInputSchema,
  CuratorReportSchema,
  type CurateInput,
  type CuratorReport,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { latestDoneStep, type RunStep } from '../db/repositories/run-steps.ts';

export interface RunCuration {
  readonly step: RunStep;
  readonly report: CuratorReport;
  /** What the step read (the spec version, the plan and research steps, the model, the level). */
  readonly input: CurateInput;
}

/**
 * The run's newest finished `curate` report and what it read, both validated (the files can be
 * edited on disk): gate 3's input. Undefined until a curate job has finished.
 */
export function latestCuration(
  db: Executor,
  dataDir: string,
  runId: number,
): RunCuration | undefined {
  const step = latestDoneStep(db, runId, 'curate');
  if (!step?.outputPath || !step.inputPath) return undefined;
  return {
    step,
    report: CuratorReportSchema.parse(readDataJson(dataDir, step.outputPath)),
    input: CurateInputSchema.parse(readDataJson(dataDir, step.inputPath)),
  };
}
