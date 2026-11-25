import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  narrationSentences,
  type Claim,
  type CuratorIssue,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import {
  loadDryRunFixtures,
  recordedInOrder,
  type DryRunFixtures,
  type DryRunResponse,
} from '#worker/llm/index.ts';
import { saveSpecVersion } from '#core/services/spec-versions.ts';
import type { Db } from '#core/db/client.ts';
import { enqueueJob } from '#core/db/repositories/jobs.ts';
import { fixtureResponsesDir, type FixtureTopicId } from '../fixture-topics.ts';
import { fixtureGeneratedSpec } from '../generator/testing.ts';
import { CURATE_JOB_TYPE } from '#worker/jobs/curate.ts';
import { seededSpec, seedResponsesDir, type CuratorSeed } from './fixtures.ts';
import { reviewBeatTexts } from './input.ts';

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

/** A dry-run answer with this JSON. */
export const answer = (value: unknown): DryRunResponse => ({
  content: JSON.stringify(value),
  servedModel: 'recorded',
  finishReason: 'stop',
  usage: null,
});

/** A complete claims audit of `spec` that supports nothing and flags nothing (all `no_claim`). */
export function quietClaims(spec: RenderableVideoSpec): DryRunResponse {
  const claims: Claim[] = reviewBeatTexts(spec).flatMap((beat) => [
    ...narrationSentences(beat.narration).map((text) => ({
      beatId: beat.beatId,
      source: 'narration' as const,
      text,
      verdict: 'no_claim' as const,
      ids: [],
    })),
    ...(beat.drawnValues ?? []).map((v) => ({
      beatId: beat.beatId,
      source: 'value' as const,
      elementId: v.elementId,
      text: v.value,
      verdict: 'no_claim' as const,
      ids: [],
    })),
  ]);
  return answer({ claims, issues: [] });
}

/** A review pair (claims, then story) of one version of `spec`, with these story issues. */
export const reviewOf = (
  spec: RenderableVideoSpec,
  issues: CuratorIssue[] = [],
  previous?: { id: string; status: string }[],
): DryRunResponse[] => [quietClaims(spec), answer({ issues, ...(previous ? { previous } : {}) })];

/**
 * Where a topic's recorded Curator round lives (`curate-round:fixture --record`): the review and
 * repair answers of one curate job with its repair loop, after the topic's recorded chain.
 */
export function curateRoundDir(topic: FixtureTopicId): string {
  return join(fixtureResponsesDir('curator', topic), '..', 'round');
}

/** A recorded Curator round, to replay after the topic's recordings (the same run, in order). */
export interface CurateRound {
  readonly curator: readonly DryRunResponse[];
  /** The repairs' Scriptwriter answers, after the recorded script's. */
  readonly scriptwriter: readonly DryRunResponse[];
  /** The repairs' Generator answers per beat, after the recorded boards. */
  readonly generator: Readonly<Record<string, readonly DryRunResponse[]>>;
}

export function curateRound(topic: FixtureTopicId): CurateRound {
  const fixtures = loadDryRunFixtures(curateRoundDir(topic));
  const ordered = (role: 'curator' | 'scriptwriter') => {
    const list = fixtures[role] ?? [];
    if (!Array.isArray(list)) throw new Error(`The ${role} round is not recorded in call order.`);
    return list as readonly DryRunResponse[];
  };
  const generator = fixtures.generator ?? {};
  if (Array.isArray(generator)) throw new Error('The Generator round is not recorded per beat.');
  return {
    curator: ordered('curator'),
    scriptwriter: ordered('scriptwriter'),
    generator: generator as Record<string, readonly DryRunResponse[]>,
  };
}
