import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { resolveDataPath, sourceUploadPath } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { createSource } from '#core/db/repositories/sources.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { startRun } from '#core/services/runs.ts';

/**
 * Test and script helpers for the Researcher (`research.test.ts`, `research:fixture`). Not
 * imported by any entrypoint.
 */

export const RATE_LIMITER_FIXTURE_DIR = fileURLToPath(
  new URL('./fixtures/rate-limiter/', import.meta.url),
);

/** Invented sources, added in this order (so a fresh DB gives them ids 1, 2, 3). */
export const RATE_LIMITER_SOURCE_FILES = [
  'token-bucket-field-guide.md',
  'quotaflow-readme.md',
  'larkspur-checkout-incident.md',
].map((name) => `${RATE_LIMITER_FIXTURE_DIR}sources/${name}`);

export const RATE_LIMITER_TOPIC = {
  title: 'Rate limiters',
  notes: 'Token bucket in a shared store, and what breaks when the store gets slow.',
} as const;

/** Recorded Researcher responses for the fixture (`loadDryRunFixtures`). */
export const RATE_LIMITER_RESPONSES_DIR = `${RATE_LIMITER_FIXTURE_DIR}responses`;

export interface SeededRun {
  readonly topicId: number;
  readonly runId: number;
  readonly sourceIds: number[];
}

/**
 * A topic whose sources are the given files, uploaded the way the app stores uploads, and a
 * started run (its `ingest` job queued).
 */
export function seedRunWithUploads(
  db: Db,
  dataDir: string,
  topic: { readonly title: string; readonly notes?: string },
  files: readonly string[],
  seriesTag = 'system-design',
): SeededRun {
  const topicId = createTopic(db, topic).id;
  const sourceIds = files.map((file) => uploadSource(db, dataDir, topicId, file));
  const seriesRow = db.select().from(series).where(eq(series.tag, seriesTag)).get();
  if (!seriesRow) throw new Error(`No series with tag ${seriesTag}`);
  const { run } = startRun(db, { topicId, seriesId: seriesRow.id });
  return { topicId, runId: run.id, sourceIds };
}

function uploadSource(db: Db, dataDir: string, topicId: number, file: string): number {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const filePath = sourceUploadPath(topicId, hash, basename(file));
  const abs = resolveDataPath(dataDir, filePath);
  mkdirSync(dirname(abs), { recursive: true });
  copyFileSync(file, abs);
  return createSource(db, { topicId, kind: 'file', filePath }).id;
}
