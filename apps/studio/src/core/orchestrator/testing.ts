import type { Db } from '../db/client.ts';
import { listRunsByStatus } from '../db/repositories/runs.ts';
import { decideAtGate } from '../services/gate-decisions.ts';
import { researchReview } from '../services/gate-checks.ts';

/** Test-only helpers. Not imported by any entrypoint. */

/**
 * Both recorded fixture topics' notes report a disagreement between their sources, which keeps
 * gate 1 from approving itself (P1C.9 step 9). For tests that put research on auto to get past
 * it, this approves gate 1 as the user would, on every run that waits there for that reason only
 * (thin research still waits). True when it approved any.
 */
export function approveDisputedResearch(db: Db, dataDir: string): boolean {
  const runs = listRunsByStatus(db, ['awaiting_review']).filter(
    (run) => run.pipelineStep === 'gate_research' && run.settings.autoApprove.research,
  );
  let approved = false;
  for (const run of runs) {
    const review = researchReview(db, dataDir, run);
    const disputedOnly =
      review !== undefined &&
      review.blocking.length > 0 &&
      review.blocking.every((issue) => issue.code === 'sources_disagree');
    if (!disputedOnly) continue;
    decideAtGate(db, dataDir, run.id, 'research', {
      action: 'approve',
      subjectId: review.research.step.id,
    });
    approved = true;
  }
  return approved;
}
