import {
  ResearchInputSchema,
  ResearchNotesSchema,
  type ResearchInput,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { latestDoneStep, type RunStep } from '../db/repositories/run-steps.ts';

export interface RunResearch {
  readonly step: RunStep;
  readonly notes: ResearchNotes;
  /** What the step read, including the chunks the source budget left out. */
  readonly input: ResearchInput;
}

/**
 * Gate 1's input: the notes of the run's newest finished research step and what it read, both
 * validated (the files can be edited on disk). Undefined until a research step has finished.
 */
export function latestResearch(
  db: Executor,
  dataDir: string,
  runId: number,
): RunResearch | undefined {
  const step = latestDoneStep(db, runId, 'research');
  if (!step?.outputPath || !step.inputPath) return undefined;
  return {
    step,
    notes: ResearchNotesSchema.parse(readDataJson(dataDir, step.outputPath)),
    input: ResearchInputSchema.parse(readDataJson(dataDir, step.inputPath)),
  };
}
