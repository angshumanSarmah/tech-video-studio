import type { SpecAuthor, Stage } from '@explainer-studio/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { runSteps } from '../schema.ts';

export type RunStep = typeof runSteps.$inferSelect;

/**
 * One row per attempt at a stage: rows are never reused, so a regenerated stage keeps the
 * earlier attempt's files and the LLM calls that point at it (`llm_calls.step_id`).
 */
export function startRunStep(
  db: Executor,
  input: {
    readonly runId: number;
    readonly stage: Stage;
    /** For a per-beat step (the Generator's). */
    readonly beatId?: string;
    /** Default `agent`; `user` for an edit saved at a gate. */
    readonly createdBy?: SpecAuthor;
    readonly now?: Date;
  },
): RunStep {
  return db
    .insert(runSteps)
    .values({
      runId: input.runId,
      stage: input.stage,
      beatId: input.beatId ?? null,
      createdBy: input.createdBy ?? 'agent',
      status: 'running',
      startedAt: input.now ?? new Date(),
    })
    .returning()
    .get();
}

export function setRunStepInput(db: Executor, id: number, inputPath: string): void {
  db.update(runSteps).set({ inputPath }).where(eq(runSteps.id, id)).run();
}

export function finishRunStep(db: Executor, id: number, outputPath: string): RunStep {
  return db
    .update(runSteps)
    .set({ status: 'done', outputPath, finishedAt: new Date(), error: null })
    .where(eq(runSteps.id, id))
    .returning()
    .get();
}

export function failRunStep(db: Executor, id: number, error: string): void {
  db.update(runSteps)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(eq(runSteps.id, id))
    .run();
}

/**
 * Marks a stage's `running` steps failed. Called when the stage starts again: with a single
 * worker, a step still running belongs to an attempt that crashed or was shut down. Returns how
 * many it marked.
 */
export function failInterruptedSteps(
  db: Executor,
  runId: number,
  stage: Stage,
  error = 'Interrupted before it finished; a later attempt replaced it.',
): number {
  return db
    .update(runSteps)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(
      and(eq(runSteps.runId, runId), eq(runSteps.stage, stage), eq(runSteps.status, 'running')),
    )
    .run().changes;
}

/** The newest finished whole-stage attempt (no beat) at a stage, or undefined. */
export function latestDoneStep(db: Executor, runId: number, stage: Stage): RunStep | undefined {
  return db
    .select()
    .from(runSteps)
    .where(
      and(
        eq(runSteps.runId, runId),
        eq(runSteps.stage, stage),
        eq(runSteps.status, 'done'),
        isNull(runSteps.beatId),
      ),
    )
    .orderBy(desc(runSteps.id))
    .limit(1)
    .get();
}

/** A beat's finished attempts at a stage, newest first. */
export function doneBeatSteps(
  db: Executor,
  runId: number,
  stage: Stage,
  beatId: string,
): RunStep[] {
  return db
    .select()
    .from(runSteps)
    .where(
      and(
        eq(runSteps.runId, runId),
        eq(runSteps.stage, stage),
        eq(runSteps.status, 'done'),
        eq(runSteps.beatId, beatId),
      ),
    )
    .orderBy(desc(runSteps.id))
    .all();
}

export function getRunStep(db: Executor, id: number): RunStep | undefined {
  return db.select().from(runSteps).where(eq(runSteps.id, id)).get();
}

/** A stage's whole-stage attempts (no beat), newest first, whatever their status. */
export function stageSteps(db: Executor, runId: number, stage: Stage): RunStep[] {
  return db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, stage), isNull(runSteps.beatId)))
    .orderBy(desc(runSteps.id))
    .all();
}
