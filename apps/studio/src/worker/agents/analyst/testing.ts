import type {
  GateDecisionRecord,
  GateId,
  MemoryRuleScope,
  NoRuleReason,
  RenderableVideoSpec,
} from '@explainer-studio/shared';
import { directPlanPath, specVersionPath, writeDataJson } from '#core/data-files.ts';
import type { Executor } from '#core/db/client.ts';
import { finishRunStep, startRunStep } from '#core/db/repositories/run-steps.ts';
import { createRun, type Run } from '#core/db/repositories/runs.ts';
import { listSeries } from '#core/db/repositories/series.ts';
import { createSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { gateEvent } from '#core/orchestrator/advance.ts';
import type { RunSettingsSource } from '@explainer-studio/shared';
import { fixtureGeneratedSpec, recordedPlan } from '../generator/testing.ts';

/**
 * The Analyst's fixture (P1C.10): a rate-limiter run with its recorded plan and generated spec,
 * and invented gate notes, each a decision event as the gate services write it. Used by the job
 * test and `analyst:fixture`. Not imported by any entrypoint.
 */

/** The Analyst's recorded answers to `FIXTURE_NOTES`, in call order (workspace-relative). */
export const ANALYST_RESPONSES_DIR = 'apps/studio/src/worker/agents/analyst/fixtures/responses';

export interface SeededRun {
  readonly run: Run;
  readonly planStepId: number;
  readonly specVersionId: number;
}

export function seedProposalRun(db: Executor, dataDir: string, app: RunSettingsSource): SeededRun {
  const topic = createTopic(db, {
    title: 'Rate limiters',
    notes: 'What happens when the shared store gets slow',
  });
  const series = listSeries(db).find((s) => s.tag === 'system-design')!;
  const run = createRun(db, { app, topicId: topic.id, seriesId: series.id });
  const step = startRunStep(db, { runId: run.id, stage: 'direct' });
  finishRunStep(
    db,
    step.id,
    writeDataJson(dataDir, directPlanPath(run.id, step.id), recordedPlan('rate-limiter')),
  );
  const specVersionId = saveVersion(db, dataDir, run.id, 1, fixtureGeneratedSpec('rate-limiter'));
  return { run, planStepId: step.id, specVersionId };
}

function saveVersion(
  db: Executor,
  dataDir: string,
  runId: number,
  version: number,
  spec: RenderableVideoSpec,
  createdBy: 'agent' | 'user' = 'agent',
): number {
  const jsonPath = writeDataJson(dataDir, specVersionPath(runId, version), spec);
  return createSpecVersion(db, { runId, version, jsonPath, createdBy }).id;
}

/** An invented note, the decision it came with, and what a good Analyst makes of it. */
export interface FixtureNote {
  readonly id: string;
  readonly gate: GateId;
  readonly note: string;
  /** The expected outcome: a rule of this scope, or no rule for this reason. */
  readonly expect: { readonly scope: MemoryRuleScope } | { readonly reason: NoRuleReason };
  readonly decision: (seeded: SeededRun, db: Executor, dataDir: string) => GateDecisionRecord;
}

/** The rate limiter's spec with two headlines shortened by hand (the headline edit). */
function editedHeadlines(): RenderableVideoSpec {
  const spec = structuredClone(fixtureGeneratedSpec('rate-limiter'));
  const short: Record<string, string> = {
    beat5: 'Checks cross the network',
    beat7: 'Each instance alone',
  };
  for (const beat of spec.script) {
    const text = short[beat.beatId];
    if (text && beat.headline) beat.headline = { ...beat.headline, text };
  }
  return spec;
}

export const FIXTURE_NOTES: readonly FixtureNote[] = [
  {
    id: 'headline-edit',
    gate: 'scenes',
    note: 'Headlines read like whole sentences. I cut these two down; keep them to a few words.',
    expect: { scope: 'scriptwriter' },
    decision: (seeded, db, dataDir) => ({
      action: 'edit',
      subjectId: seeded.specVersionId,
      savedId: saveVersion(db, dataDir, seeded.run.id, 2, editedHeadlines(), 'user'),
      note: '',
    }),
  },
  {
    id: 'busy-board',
    gate: 'scenes',
    note: 'Too many boxes on screen at once here. I lose track of the one request we follow.',
    expect: { scope: 'generator' },
    decision: (seeded) => ({
      action: 'regenerate',
      subjectId: seeded.specVersionId,
      target: 'beat',
      beatId: 'beat7',
      fields: ['board'],
    }),
  },
  {
    id: 'same-opening',
    gate: 'beat_sheet',
    note: 'Fine, but this opens on an incident again, like the last few. Vary how videos open.',
    expect: { scope: 'director' },
    decision: (seeded) => ({ action: 'approve', subjectId: seeded.planStepId }),
  },
  {
    id: 'wrong-date',
    gate: 'draft',
    note: 'The outage date in the first beat is wrong, the post-mortem says it was a Tuesday.',
    expect: { reason: 'one_off' },
    decision: () => ({ action: 'reject' }),
  },
  {
    id: 'contractions',
    gate: 'scenes',
    note: 'The review flagged contractions like "can\'t" as too informal again. That is our voice: stop flagging them.',
    expect: { scope: 'curator' },
    decision: (seeded) => ({ action: 'approve', subjectId: seeded.specVersionId }),
  },
];

/** Writes a fixture note as its decision event (as the gate services do); returns the event id. */
export function seedNote(
  db: Executor,
  dataDir: string,
  seeded: SeededRun,
  note: FixtureNote,
): number {
  const decision = { ...note.decision(seeded, db, dataDir), note: note.note };
  const status =
    decision.action === 'approve'
      ? 'approved'
      : decision.action === 'reject'
        ? 'rejected'
        : 'pending';
  return gateEvent(db, seeded.run, note.gate, status, 'user', [], decision);
}
