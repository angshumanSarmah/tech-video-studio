import { patchRunSettings, type ModelPrice, type RunSettingsPatch } from '@explainer-studio/shared';
import type { Db, Executor } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { listRunJobs } from '../db/repositories/jobs.ts';
import { runCostUsd } from '../db/repositories/llm-calls.ts';
import { getRun, setActiveRunStatus, setRunSettings, type Run } from '../db/repositories/runs.ts';
import { ConflictError } from '../errors.ts';
import { advanceRun } from '../orchestrator/advance.ts';
import { PIPELINE } from '../orchestrator/pipeline.ts';
import { requireRun } from '../orchestrator/snapshot.ts';

/**
 * "Update run settings" (P1C.9 steps 4-5): the named fields merged onto the run's overrides and
 * its settings snapshot (`patchRunSettings`), so the run's next job uses them and nothing else
 * changes; the app settings are not re-read, except for the price of a newly named model
 * (`priceOf`). Only between jobs: for a run waiting at a gate or paused. What finished steps did
 * stays as it was. The change is logged; the orchestrator then moves the run on if it now can (an
 * auto-approve switched on).
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
    assertBetweenJobs(run, tx);
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
    if (run.status === 'paused') resumeUnderCap(tx, run.id, snapshot.budget.maxRunUsd);
    advanceRun(tx, dataDir, run.id);
    return getRun(tx, run.id)!;
  });
}

/**
 * Between jobs: waiting at a gate with no job queued or running, or paused (its requeued job
 * waits in the queue; none may be running).
 */
function assertBetweenJobs(run: Run, tx: Executor): void {
  const jobs = listRunJobs(tx, run.id);
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const atGate = run.status === 'awaiting_review' && PIPELINE[run.pipelineStep].kind === 'gate';
  const ok = run.status === 'paused' ? running === 0 : atGate && running + queued === 0;
  if (!ok) {
    const active = running + queued;
    throw new ConflictError(
      `Run ${run.id}'s settings can change only while it waits at a gate or is paused ` +
        `(it is ${run.status} at ${run.pipelineStep}${active > 0 ? `, with ${active} job(s) active` : ''}).`,
    );
  }
}

/** A run paused by its cost cap runs again once the cap is above what it has spent. */
function resumeUnderCap(tx: Executor, runId: number, cap: number): void {
  const spent = runCostUsd(tx, runId);
  const message =
    spent < cap
      ? `Resumed: $${spent.toFixed(4)} spent, under the new $${cap.toFixed(2)} cap.`
      : `Still paused: $${spent.toFixed(4)} spent is not under the $${cap.toFixed(2)} cap.`;
  if (spent < cap) {
    const run = setActiveRunStatus(tx, runId, 'running');
    if (run) {
      appendEvent(tx, {
        runId,
        type: 'run_status',
        payload: { status: 'running', step: run.pipelineStep },
      });
    }
  }
  appendEvent(tx, { runId, type: 'log', payload: { level: 'info', message } });
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
