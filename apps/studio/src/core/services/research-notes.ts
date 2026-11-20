import {
  ResearchInputSchema,
  ResearchNotesSchema,
  type ResearchInput,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { getRunStep, latestDoneStep, type RunStep } from '../db/repositories/run-steps.ts';

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
  return step ? readResearch(dataDir, step) : undefined;
}

/**
 * The notes of one research step (the one a later step names, e.g. the Director's
 * `researchStepId`), validated. Undefined unless it is a finished research step.
 */
export function researchOfStep(
  db: Executor,
  dataDir: string,
  stepId: number,
): RunResearch | undefined {
  const step = getRunStep(db, stepId);
  if (step?.stage !== 'research' || step.status !== 'done') return undefined;
  return readResearch(dataDir, step);
}

function readResearch(dataDir: string, step: RunStep): RunResearch | undefined {
  if (!step.outputPath || !step.inputPath) return undefined;
  return {
    step,
    notes: ResearchNotesSchema.parse(readDataJson(dataDir, step.outputPath)),
    input: ResearchInputSchema.parse(readDataJson(dataDir, step.inputPath)),
  };
}
