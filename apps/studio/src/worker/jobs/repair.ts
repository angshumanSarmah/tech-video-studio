import { PROGRESS_DONE_PCT, RepairRequestSchema, type Stage } from '@explainer-studio/shared';
import { z } from 'zod';
import { LlmOutputInvalidError } from '../llm/client.ts';
import { repairBeats, type RepairDeps } from '../repair/repair-beats.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const REPAIR_JOB_TYPE = 'repair' satisfies Stage;

export type RepairJobDeps = RepairDeps;

const PayloadSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  /** What to change on which beats: a gate's "regenerate beat" (P1C.9), its feedback as issues. */
  requests: z.array(RepairRequestSchema).min(1),
});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * A gate's "regenerate beat N" (P1C.9 step 5): `repairBeats` on the pinned version, the same
 * service the Curator's repair loop uses (the Scriptwriter revises the named fields, changed
 * narration is synthesised, the board is remapped or drawn again by the Generator, the video is
 * re-timed and saved as one version; beats not named keep their script and board). An agent that
 * cannot produce a valid answer leaves the version as it was, logged: the run goes on to curate
 * and back to the gate, rather than failing.
 */
export function repairJobHandler(deps: RepairJobDeps): JobHandler {
  return defineJobHandler({
    type: REPAIR_JOB_TYPE,
    description: 'Regenerate one beat’s script and/or board with the reviewer’s feedback.',
    payloadSchema: PayloadSchema,
    run: (ctx) => repair(deps, ctx),
  });
}

async function repair(deps: RepairJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A repair job needs a run.');
  try {
    const result = await repairBeats(deps, {
      runId,
      specVersionId: ctx.payload.specVersionId,
      requests: ctx.payload.requests,
      signal: ctx.signal,
      log: ctx.log,
    });
    const changed = result.beats.filter((b) => b.script === 'revised' || b.board !== 'kept');
    ctx.log(
      'info',
      `Regenerated: ${changed.map((b) => `${b.beatId} (script ${b.script}, board ${b.board})`).join(', ') || 'nothing changed'}; ` +
        `v${result.version}${result.created ? '' : ' (unchanged)'}.`,
    );
  } catch (error) {
    if (!(error instanceof LlmOutputInvalidError)) throw error;
    ctx.log('warn', `The ${error.role} could not make a valid change; the beat stays as it was.`);
  }
  ctx.progress(PROGRESS_DONE_PCT, 'Beat regenerated');
}
