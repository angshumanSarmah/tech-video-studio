import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { readDataJson, repairBeatStepPath, writeDataJson } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import {
  doneBeatSteps,
  failRunStep,
  finishRunStep,
  setRunStepInput,
  startRunStep,
} from '#core/db/repositories/run-steps.ts';

/**
 * A repair's sub-steps (P1C.8): one `run_steps` row per beat and kind (stage `repair`,
 * `beat_id`), its input file carrying the kind and an input hash. A finished step of the same
 * beat, kind and hash is reused, so a repair that crashed (or runs again with the same requests)
 * pays only for what it had not finished.
 */

export type RepairStepKind = 'script' | 'narrate' | 'remap';

export interface StepScope {
  readonly db: Db;
  readonly dataDir: string;
  readonly runId: number;
}

/** sha256 of a value's JSON: the input hash of a sub-step. */
export function inputHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface StepResult<T> {
  readonly value: T;
  readonly stepId: number;
  readonly reused: boolean;
}

/** The finished step's output when one with the same input exists, else `run`'s, recorded. */
export async function subStep<T>(
  scope: StepScope,
  step: {
    readonly beatId: string;
    readonly kind: RepairStepKind;
    readonly hash: string;
    /** Written to the input file next to the kind and hash, for the record. */
    readonly input?: unknown;
    readonly output: z.ZodType<T>;
  },
  run: (stepId: number) => Promise<T> | T,
): Promise<StepResult<T>> {
  const reused = finishedStep(scope, step);
  if (reused) return { ...reused, reused: true };
  const row = startRunStep(scope.db, { runId: scope.runId, stage: 'repair', beatId: step.beatId });
  const path = (side: 'input' | 'output') =>
    repairBeatStepPath(scope.runId, step.beatId, step.kind, row.id, side);
  setRunStepInput(
    scope.db,
    row.id,
    writeDataJson(scope.dataDir, path('input'), {
      kind: step.kind,
      inputHash: step.hash,
      input: step.input ?? null,
    }),
  );
  try {
    const value = await run(row.id);
    finishRunStep(scope.db, row.id, writeDataJson(scope.dataDir, path('output'), value));
    return { value, stepId: row.id, reused: false };
  } catch (error) {
    failRunStep(scope.db, row.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function finishedStep<T>(
  scope: StepScope,
  step: { beatId: string; kind: RepairStepKind; hash: string; output: z.ZodType<T> },
): { value: T; stepId: number } | undefined {
  for (const row of doneBeatSteps(scope.db, scope.runId, 'repair', step.beatId)) {
    if (!row.inputPath || !row.outputPath) continue;
    const input = readDataJson(scope.dataDir, row.inputPath) as {
      kind?: string;
      inputHash?: string;
    };
    if (input.kind !== step.kind || input.inputHash !== step.hash) continue;
    const parsed = step.output.safeParse(readDataJson(scope.dataDir, row.outputPath));
    if (parsed.success) return { value: parsed.data, stepId: row.id };
  }
  return undefined;
}
