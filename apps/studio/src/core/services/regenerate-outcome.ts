import {
  failedRequestOutcomes,
  RepairInputSchema,
  RepairOutputSchema,
  type GateId,
  type RegenerateOutcome,
  type RepairRequestOutcome,
} from '@explainer-studio/shared';
import { readDataJson } from '../data-files.ts';
import type { Executor } from '../db/client.ts';
import { gateEvents, type GateEvent } from '../db/repositories/events.ts';
import { stageSteps, type RunStep } from '../db/repositories/run-steps.ts';

/**
 * What a person's beat regenerate did (run 1's b2 fix failed and the gate looked the same as a
 * success). The decision's `gate` event id travels in its repair job's payload into the repair
 * step's input (`decisionEventId`), so the step that carried it out is found by that id, never
 * by time. A finished step gives each request's outcome; a failed one (an agent's answer stayed
 * invalid, nothing saved) makes every request `unchanged` with the failure as the reason.
 */

/** The outcome of the latest decision at this gate when that decision was a beat regenerate. */
export function latestRegenerateOutcome(
  db: Executor,
  dataDir: string,
  runId: number,
  gate: GateId,
): RegenerateOutcome | null {
  const latest = gateEvents(db, runId, gate).find((e) => e.payload.decision);
  return latest && isBeatRegenerate(latest)
    ? regenerateOutcomeOf(db, dataDir, runId, latest.id)
    : null;
}

/**
 * The outcome to record on the gate event that reopens this gate: only when the gate's last
 * event is the regenerate decision itself (the gate has not reopened since).
 */
export function reopeningOutcome(
  db: Executor,
  dataDir: string,
  runId: number,
  gate: GateId,
): RegenerateOutcome | null {
  const last = gateEvents(db, runId, gate)[0];
  return last && isBeatRegenerate(last) ? regenerateOutcomeOf(db, dataDir, runId, last.id) : null;
}

/** The repair step carrying out decision `eventId`, newest attempt first; null until it ran. */
export function regenerateOutcomeOf(
  db: Executor,
  dataDir: string,
  runId: number,
  eventId: number,
): RegenerateOutcome | null {
  for (const step of stageSteps(db, runId, 'repair')) {
    const input = repairInputOf(dataDir, step);
    if (input?.decisionEventId !== eventId) continue;
    const requests = stepOutcomes(dataDir, step, input.requests);
    return requests ? { decisionEventId: eventId, requests } : null;
  }
  return null;
}

const isBeatRegenerate = (event: GateEvent): boolean =>
  event.payload.decision?.action === 'regenerate' && event.payload.decision.target === 'beat';

function repairInputOf(dataDir: string, step: RunStep) {
  if (!step.inputPath) return undefined;
  const parsed = RepairInputSchema.safeParse(readDataJson(dataDir, step.inputPath));
  return parsed.success ? parsed.data : undefined;
}

function stepOutcomes(
  dataDir: string,
  step: RunStep,
  requests: Parameters<typeof failedRequestOutcomes>[0],
): RepairRequestOutcome[] | null {
  if (step.status === 'failed') return failedRequestOutcomes(requests, step.error ?? '');
  if (step.status !== 'done' || !step.outputPath) return null;
  const output = RepairOutputSchema.safeParse(readDataJson(dataDir, step.outputPath));
  return output.success ? (output.data.requests ?? null) : null;
}
