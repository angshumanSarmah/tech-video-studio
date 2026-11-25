import {
  patchRunSettings,
  RunSettingsConflictError,
  type ModelPrice,
  type RunSettingsPatch,
} from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { listRunJobs } from '../db/repositories/jobs.ts';
import {
  getRun,
  listPartRuns,
  setActiveRunStatus,
  setRunSettings,
  type Run,
} from '../db/repositories/runs.ts';
import { ConflictError } from '../errors.ts';
import { advanceRun } from '../orchestrator/advance.ts';
import { PIPELINE } from '../orchestrator/pipeline.ts';
import { requireRun } from '../orchestrator/snapshot.ts';
import { videoBudget } from './budget.ts';

/**
 * "Update run settings" (P1C.9 steps 4-5): the named fields merged onto the run's overrides and
 * its settings snapshot (`patchRunSettings`), so the run's next job uses them and nothing else
 * changes; the app settings are not re-read, except for the price of a newly named model
 * (`priceOf`). Only between jobs: for a run waiting at a gate or paused, or (the cost cap only)
 * a parent waiting for its parts. What finished steps did stays as it was. The change is logged;
 * the orchestrator then moves the run on if it now can (an auto-approve switched on). The cap is
 * the whole video's (`videoBudget`): a part's is set on its parent, and raising it resumes every
 * run of the video it paused.
 */

export interface UpdateRunSettingsInput {
  readonly runId: number;
  readonly patch: RunSettingsPatch;
  /** The app's price of a model (read only for a model the snapshot has no price for). */
  readonly priceOf: (model: string) => ModelPrice | undefined;
}

export function updateRunSettings(db: Db, dataDir: string, input: UpdateRunSettingsInput): Run {
  return db.transaction((tx) => {
    const run = requireRun(tx, input.runId);
    assertCapOnParent(run, input.patch);
    assertBetweenJobs(run, tx, input.patch);
    const { settings, snapshot } = patchRunSettings(
      { settings: run.settings, snapshot: run.resolvedSettings },
      input.patch,
      input.priceOf,
    );
    setRunSettings(tx, run.id, settings, snapshot);
    const changes = [
      ...settingsChanges('settings', run.settings, settings),
      ...settingsChanges('snapshot', run.resolvedSettings, snapshot),
    ];
    appendEvent(tx, {
      runId: run.id,
      type: 'log',
      payload: {
        level: 'info',
        message:
          changes.length === 0
            ? 'Run settings updated: nothing changed.'
            : `Run settings updated: ${changes.join('; ')}.`,
      },
    });
    resumeUnderCap(tx, run);
    advanceRun(tx, dataDir, run.id);
    return getRun(tx, run.id)!;
  });
}

/** A part's cost cap is its parent's (the whole video's): it is set there. */
function assertCapOnParent(run: Run, patch: RunSettingsPatch): void {
  if (run.parentRunId === null || patch.budget === undefined) return;
  throw new RunSettingsConflictError(
    `Run ${run.id} is part ${run.partIndex} of run ${run.parentRunId}: the cost cap covers the ` +
      `whole video, so set budget.maxRunUsd on run ${run.parentRunId}.`,
  );
}

/**
 * Between jobs: waiting at a gate with no job queued or running, or paused (its requeued job
 * waits in the queue; none may be running); or, for the cost cap alone, a parent waiting for its
 * parts (it has no job of its own).
 */
function assertBetweenJobs(run: Run, tx: Executor, patch: RunSettingsPatch): void {
  const jobs = listRunJobs(tx, run.id);
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const kind = PIPELINE[run.pipelineStep].kind;
  const atGate = run.status === 'awaiting_review' && kind === 'gate';
  const capOnly = Object.keys(patch).every((key) => key === 'budget');
  const waitingForParts = run.status === 'running' && kind === 'children' && capOnly;
  const ok =
    run.status === 'paused' ? running === 0 : (atGate || waitingForParts) && running + queued === 0;
  if (!ok) {
    const active = running + queued;
    throw new ConflictError(
      `Run ${run.id}'s settings can change only while it waits at a gate or is paused, or (the ` +
        `cost cap only) while it waits for its parts (it is ${run.status} at ` +
        `${run.pipelineStep}${active > 0 ? `, with ${active} job(s) active` : ''}).`,
    );
  }
}

/**
 * The runs of the video that its cost cap paused (the run, or a parent's parts) run again once
 * the cap is above what the whole video has spent; each gets a `run_status` event, and a log line
 * either way.
 */
function resumeUnderCap(tx: Executor, run: Run): void {
  const paused = [run, ...listPartRuns(tx, run.id)].filter((r) => r.status === 'paused');
  const budget = videoBudget(tx, run.id);
  if (paused.length === 0 || !budget) return;
  const { spentUsd: spent, capUsd: cap } = budget;
  const under = spent < cap;
  const message = under
    ? `Resumed: $${spent.toFixed(4)} spent, under the new $${cap.toFixed(2)} cap.`
    : `Still paused: $${spent.toFixed(4)} spent is not under the $${cap.toFixed(2)} cap.`;
  for (const target of paused) {
    const resumed = under ? setActiveRunStatus(tx, target.id, 'running') : undefined;
    if (resumed) {
      appendEvent(tx, {
        runId: target.id,
        type: 'run_status',
        payload: { status: 'running', step: resumed.pipelineStep },
      });
    }
    appendEvent(tx, { runId: target.id, type: 'log', payload: { level: 'info', message } });
  }
}

/** Pure: every leaf that differs, as `<prefix>.<path>: <before> → <after>`, in key order. */
export function settingsChanges(prefix: string, before: unknown, after: unknown): string[] {
  const a = leaves(before);
  const b = leaves(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  return keys
    .filter((k) => a.get(k) !== b.get(k))
    .map((k) => `${prefix}.${k}: ${a.get(k) ?? 'unset'} → ${b.get(k) ?? 'unset'}`);
}

function leaves(value: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, path ? `${path}.${key}` : key, out);
    }
  } else if (value !== undefined) {
    out.set(path, JSON.stringify(value));
  }
  return out;
}
