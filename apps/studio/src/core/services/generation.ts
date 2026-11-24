import {
  GenerateInputSchema,
  GenerateOutputSchema,
  type GenerateInput,
  type GenerateOutput,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { latestDoneStep, type RunStep } from '../db/repositories/run-steps.ts';

export interface RunGeneration {
  /** The job's whole-stage step (no `beat_id`). */
  readonly step: RunStep;
  readonly input: GenerateInput;
  /** Beats by outcome, the spec version saved, the warnings left for gate 3, the job's usage. */
  readonly output: GenerateOutput;
}

/**
 * Gate 3's Generator result: the newest finished `generate` job of the run, validated.
 * Undefined until one has finished. Each beat's board is in the spec version it saved.
 */
export function latestGeneration(
  db: Executor,
  dataDir: string,
  runId: number,
): RunGeneration | undefined {
  const step = latestDoneStep(db, runId, 'generate');
  if (!step?.outputPath || !step.inputPath) return undefined;
  return {
    step,
    input: GenerateInputSchema.parse(readDataJson(dataDir, step.inputPath)),
    output: GenerateOutputSchema.parse(readDataJson(dataDir, step.outputPath)),
  };
}
