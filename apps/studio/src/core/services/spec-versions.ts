import type { SpecAuthor } from '@explainer-studio/shared';
import { readDataText, specVersionPath, writeDataJson } from '../data-files.ts';
import type { Db } from '../db/client.ts';
import {
  createSpecVersion,
  getLatestSpecVersion,
  getSpecVersion,
  type SpecVersion,
} from '../db/repositories/spec-versions.ts';

/** The `spec_versions` row a job is pinned to; throws unless it exists and belongs to `runId`. */
export function pinnedSpecVersion(db: Db, runId: number, specVersionId: number): SpecVersion {
  const version = getSpecVersion(db, specVersionId);
  if (!version) throw new Error(`Spec version ${specVersionId} does not exist.`);
  if (version.runId !== runId) {
    throw new Error(
      `Spec version ${specVersionId} belongs to run ${version.runId}, not run ${runId}.`,
    );
  }
  return version;
}

export interface SaveSpecVersionInput {
  readonly runId: number;
  /** A validated spec; stored as pretty JSON. */
  readonly spec: unknown;
  readonly createdBy: SpecAuthor;
  /** Required for, and only for, `external` specs (a DB check). */
  readonly sourceLabel?: string;
  readonly note?: string;
}

export interface SavedSpecVersion {
  readonly version: SpecVersion;
  /** False when the run's latest version already had exactly this JSON (nothing was written). */
  readonly created: boolean;
}

const specJson = (spec: unknown) => `${JSON.stringify(spec, null, 2)}\n`;

/**
 * Saves `spec` as the run's next version (file, then row, in one transaction), unless the latest
 * version holds the same JSON: a job that reruns after a crash (at-least-once delivery) does not
 * stack identical versions.
 */
export function saveSpecVersion(
  db: Db,
  dataDir: string,
  input: SaveSpecVersionInput,
): SavedSpecVersion {
  return db.transaction((tx) => {
    const latest = getLatestSpecVersion(tx, input.runId);
    if (latest && readDataText(dataDir, latest.jsonPath) === specJson(input.spec)) {
      return { version: latest, created: false };
    }
    const number = (latest?.version ?? 0) + 1;
    const jsonPath = writeDataJson(dataDir, specVersionPath(input.runId, number), input.spec);
    const version = createSpecVersion(tx, {
      runId: input.runId,
      version: number,
      jsonPath,
      createdBy: input.createdBy,
      sourceLabel: input.sourceLabel ?? null,
      note: input.note ?? null,
    });
    return { version, created: true };
  });
}
