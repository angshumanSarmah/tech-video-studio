import {
  resolveRunSettings,
  RunSettingsSchema,
  type RunSettingsInput,
  type RunSettingsSource,
} from '@explainer-studio/shared';
import type { Db } from '../db/client.ts';
import { appendEvent } from '../db/repositories/events.ts';
import { listRunJobs } from '../db/repositories/jobs.ts';
import { getRun, setRunSettings, type Run } from '../db/repositories/runs.ts';
import { ConflictError } from '../errors.ts';
import { advanceRun } from '../orchestrator/advance.ts';
import { PIPELINE } from '../orchestrator/pipeline.ts';
import { requireRun } from '../orchestrator/snapshot.ts';

/**
 * "Update run settings" (P1C.9 step 4): the run's overrides replaced, and a new settings snapshot
 * resolved from them and the app settings as they are now (so a model or price changed in
 * settings.json since the run started applies from its next job). Only between jobs: for a run
 * waiting at a gate or paused. What finished steps did stays as it was. The change is logged; the
 * orchestrator then moves the run on if it now can (an auto-approve switched on).
 */

export interface UpdateRunSettingsInput {
  readonly runId: number;
  readonly settings: RunSettingsInput;
  readonly app: RunSettingsSource;
}

export function updateRunSettings(db: Db, dataDir: string, input: UpdateRunSettingsInput): Run {
  return db.transaction((tx) => {
    const run = requireRun(tx, input.runId);
    assertBetweenJobs(run, activeJobs(tx, run.id));
    const settings = RunSettingsSchema.parse(input.settings);
    const snapshot = resolveRunSettings(settings, input.app);
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
    advanceRun(tx, dataDir, run.id);
    return getRun(tx, run.id)!;
  });
}

const activeJobs = (db: Parameters<typeof listRunJobs>[0], runId: number) =>
  listRunJobs(db, runId).filter((j) => j.status === 'queued' || j.status === 'running').length;

function assertBetweenJobs(run: Run, active: number): void {
  const atGate = run.status === 'awaiting_review' && PIPELINE[run.pipelineStep].kind === 'gate';
  if (!(atGate || run.status === 'paused') || active > 0) {
    throw new ConflictError(
      `Run ${run.id}'s settings can change only while it waits at a gate or is paused ` +
        `(it is ${run.status} at ${run.pipelineStep}${active > 0 ? `, with ${active} job(s) active` : ''}).`,
    );
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
