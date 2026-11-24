import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { recordedInOrder, type DryRunFixtures } from '#worker/llm/index.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import type { Db } from '#core/db/client.ts';
import { enqueueJob } from '#core/db/repositories/jobs.ts';
import { fixtureResponsesDir, type FixtureTopicId } from '../fixture-topics.ts';
import { fixtureGeneratedSpec } from '../generator/testing.ts';
import { CURATE_JOB_TYPE } from '#worker/jobs/curate.ts';
import { seededSpec, seedResponsesDir, type CuratorSeed } from './fixtures.ts';

/**
 * Test and script helpers for the Curator: the spec it reviews for a fixture topic (the recorded
 * plan, script and boards, timed; with a seed planted when given), saved as the run's spec
 * version, and the recorded answers to replay. Not imported by any entrypoint.
 */

/**
 * The fixture spec (seeded or not) saved to the run, and the `curate` job queued for it: review
 * only unless `repair` (recorded reviews have no recorded repairs).
 */
export function queueFixtureCurate(
  db: Db,
  dataDir: string,
  runId: number,
  topic: FixtureTopicId,
  seed?: CuratorSeed,
  options: { readonly repair?: boolean } = {},
): number {
  const base = fixtureGeneratedSpec(topic);
  const spec = seed ? seededSpec(base, seed) : base;
  const saved = saveSpecVersion(db, dataDir, { runId, spec, createdBy: 'agent' });
  return enqueueJob(db, {
    type: CURATE_JOB_TYPE,
    runId,
    payload: { specVersionId: saved.version.id, repair: options.repair ?? false },
  }).id;
}

/** Where the Curator's recorded answers for a topic (or a seed of it) live. */
export function curatorResponsesDir(topic: FixtureTopicId, seed?: CuratorSeed): string {
  return seed ? seedResponsesDir(seed) : fixtureResponsesDir('curator', topic);
}

/**
 * The recorded answers a fixture curate run replays: the Researcher's and the Director's for the
 * topic (the run needs their steps; the Scriptwriter and the Generator are never called, the spec
 * holds their recorded work) and the Curator's from `curatorDir`, once recorded.
 */
export function recordedChain(topic: FixtureTopicId, curatorDir: string): DryRunFixtures {
  return {
    researcher: recordedInOrder(fixtureResponsesDir('researcher', topic), 'researcher'),
    director: recordedInOrder(fixtureResponsesDir('director', topic), 'director'),
    ...(existsSync(join(curatorDir, 'curator.json'))
      ? { curator: recordedInOrder(curatorDir, 'curator') }
      : {}),
  };
}
