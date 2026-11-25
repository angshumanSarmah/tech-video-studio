import {
  FIELD_OWNERS,
  GATE_IDS,
  type FixField,
  type GateDecisionRequest,
  type GateId,
  type RepairRequest,
  type StepRequests,
} from '@explainer-studio/shared';
import type { Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { markCarried, reopenGate } from '../db/repositories/gates.ts';
import { setStepRequests, type Run } from '../db/repositories/runs.ts';
import { getSource } from '../db/repositories/sources.ts';
import { advanceRun, moveTo } from '../orchestrator/advance.ts';
import { regenerateRoute, RegenerateNotAllowedError } from '../orchestrator/decide.ts';
import { GATE_STEPS, isAfter } from '../orchestrator/pipeline.ts';
import { currentSubject, readSpecVersion } from './gates.ts';

/**
 * A gate's "regenerate" (P1C.9 step 5): the run goes back to the step that reruns the target
 * (`regenerateRoute`), with what the rerun needs left for its jobs (`runs.step_requests`): the
 * reviewer's feedback for the Researcher, the Director, the Scriptwriter or every board; the
 * source to fetch again; one beat's repair requests and a curate scoped to what it changed. The
 * deciding gate and every later one are reviewed again; an earlier gate the rerun passes keeps
 * its approval for the new subject, marked with the deciding gate (`carried_from`).
 */

export type RegenerateDecision = Extract<GateDecisionRequest, { action: 'regenerate' }>;

export function regenerateAtGate(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  decision: RegenerateDecision,
): void {
  const route = regenerateRoute(gate, decision.target);
  const requests = stepRequests(tx, dataDir, run, gate, decision);
  for (const reopened of route.reopen) reopenGate(tx, run.id, reopened);
  for (const passed of passedGates(gate, route.from)) markCarried(tx, run.id, passed, gate);
  setStepRequests(tx, run.id, requests);
  appendEvent(tx, {
    runId: run.id,
    type: 'log',
    payload: { level: 'info', message: describe(gate, decision, route.from) },
  });
  moveTo(tx, run, route.from);
  advanceRun(tx, dataDir, run.id);
}

/** Gates before `gate` whose steps a rerun from `from` passes through again. */
export function passedGates(gate: GateId, from: Parameters<typeof isAfter>[0]): GateId[] {
  return GATE_IDS.filter(
    (g) => isAfter(GATE_STEPS[gate], GATE_STEPS[g]) && isAfter(GATE_STEPS[g], from),
  );
}

/** What each rerun step's job gets besides its usual payload; a 400 for what the target lacks. */
function stepRequests(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  d: RegenerateDecision,
): StepRequests {
  const feedback = d.feedback ? { feedback: d.feedback } : undefined;
  refuseExtras(d);
  switch (d.target) {
    case 'researcher':
      return feedback ? { research: feedback } : {};
    case 'source':
      return {
        ingest: { refetchSourceIds: [requireSource(tx, run, d.sourceId)] },
        ...(feedback ? { research: feedback } : {}),
      };
    case 'director':
      return feedback ? { direct: feedback } : {};
    case 'scriptwriter':
      return feedback ? { script: feedback } : {};
    case 'generator':
      return { generate: { redraw: true, ...feedback } };
    case 'beat':
      return beatRequests(tx, dataDir, run, gate, d);
  }
}

/** Fields that belong to another target are a 400, not silently dropped. */
function refuseExtras(d: RegenerateDecision): void {
  const extras = [
    d.target !== 'beat' && d.beatId !== undefined && 'beatId',
    d.target !== 'beat' && d.fields !== undefined && 'fields',
    d.target !== 'source' && d.sourceId !== undefined && 'sourceId',
  ].filter(Boolean);
  if (extras.length > 0) {
    throw new RegenerateNotAllowedError(`${extras.join(', ')} do not apply to ${d.target}.`);
  }
}

function requireSource(tx: Executor, run: Run, sourceId: number | undefined): number {
  if (sourceId === undefined) {
    throw new RegenerateNotAllowedError('Name the source to fetch again (sourceId).');
  }
  if (getSource(tx, sourceId)?.topicId !== run.topicId) {
    throw new RegenerateNotAllowedError(`Source ${sourceId} is not one of this topic's sources.`);
  }
  return sourceId;
}

/**
 * One beat: a repair request per agent that owns one of the named fields, the feedback as its
 * issue, then a curate scoped to the beats the repair changed (against the version the gate
 * reviews, which the last curation ended on).
 */
function beatRequests(
  tx: Executor,
  dataDir: string,
  run: Run,
  gate: GateId,
  d: RegenerateDecision,
): StepRequests {
  if (!d.beatId || !d.fields || !d.feedback) {
    throw new RegenerateNotAllowedError(
      'Regenerating a beat needs its beatId, the fields to change and feedback.',
    );
  }
  const subject = currentSubject(tx, dataDir, run, gate)?.specVersionId;
  const spec = subject === undefined ? undefined : readSpecVersion(tx, dataDir, subject);
  if (!spec?.story.beats.some((b) => b.id === d.beatId)) {
    throw new RegenerateNotAllowedError(`The spec has no beat "${d.beatId}".`);
  }
  return {
    repair: { requests: repairRequestsFor(d.beatId, d.fields, d.feedback) },
    curate: { scope: { sinceSpecVersionId: subject } },
  };
}

/** Pure: the named fields grouped by the agent that owns them, each with the feedback. */
export function repairRequestsFor(
  beatId: string,
  fields: readonly FixField[],
  feedback: string,
): RepairRequest[] {
  if (fields.includes('plan')) {
    throw new RegenerateNotAllowedError(
      'A plan change goes through the beat sheet: regenerate the Director at gate 2.',
    );
  }
  const issues = [{ code: 'reviewer_feedback', message: feedback }];
  const owners = ['scriptwriter', 'generator'] as const;
  return owners.flatMap((owner) => {
    const owned = [...new Set(fields.filter((f) => FIELD_OWNERS[f] === owner))];
    return owned.length > 0 ? [{ beatId, owner, fields: owned, issues }] : [];
  });
}

function describe(gate: GateId, d: RegenerateDecision, from: string): string {
  const what =
    d.target === 'beat'
      ? `beat ${d.beatId} (${d.fields?.join(', ')})`
      : d.target === 'source'
        ? `source ${d.sourceId}`
        : d.target;
  const note = d.feedback ? ` with feedback: "${d.feedback}"` : '';
  return `Regenerate ${what} at the ${gate} gate${note}: the run goes back to ${from}.`;
}
