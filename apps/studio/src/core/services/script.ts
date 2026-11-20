import {
  ScriptwriterInputSchema,
  ScriptwriterOutputSchema,
  type ScriptwriterInput,
  type ScriptwriterOutput,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { latestDoneStep, type RunStep } from '../db/repositories/run-steps.ts';

export interface RunScript {
  readonly step: RunStep;
  readonly output: ScriptwriterOutput;
  /** What the step read (the Director and research steps, pace, budgets, style rules). */
  readonly input: ScriptwriterInput;
}

/**
 * The script of the run's newest finished Scriptwriter step and what it read, both validated
 * (the files can be edited on disk). Undefined until a Scriptwriter step has finished.
 */
export function latestScript(db: Executor, dataDir: string, runId: number): RunScript | undefined {
  const step = latestDoneStep(db, runId, 'script');
  if (!step?.outputPath || !step.inputPath) return undefined;
  return {
    step,
    output: ScriptwriterOutputSchema.parse(readDataJson(dataDir, step.outputPath)),
    input: ScriptwriterInputSchema.parse(readDataJson(dataDir, step.inputPath)),
  };
}
