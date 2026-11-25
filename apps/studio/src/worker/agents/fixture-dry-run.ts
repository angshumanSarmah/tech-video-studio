import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DryRunFixtures, DryRunResponse } from '../llm/dry-run.ts';
import { loadDryRunFixtures, recordedInOrder } from '../llm/dry-run.ts';
import { curateRound } from './curator/testing.ts';
import { fixtureResponsesDir, type FixtureTopicId } from './fixture-topics.ts';

/**
 * A fixture topic's recordings in one dry-run directory (`LLM_DRY_RUN_DIR`, the CLI's
 * `--dry-run`), for a whole run with every gate on auto: the recorded Researcher, Director and
 * Scriptwriter, the Generator's boards, and the topic's recorded Curator round (its review, then
 * its repairs' Scriptwriter and Generator answers after the recorded ones). Not imported by any
 * entrypoint.
 */
export function topicDryRunFixtures(topic: FixtureTopicId): DryRunFixtures {
  const round = curateRound(topic);
  const recorded = (role: 'researcher' | 'director' | 'scriptwriter') =>
    recordedInOrder(fixtureResponsesDir(role, topic), role);
  const boards = loadDryRunFixtures(fixtureResponsesDir('generator', topic)).generator as Record<
    string,
    readonly DryRunResponse[]
  >;
  const beats = new Set([...Object.keys(boards), ...Object.keys(round.generator)]);
  return {
    researcher: [...recorded('researcher')],
    director: [...recorded('director')],
    scriptwriter: [...recorded('scriptwriter'), ...round.scriptwriter],
    generator: Object.fromEntries(
      [...beats].map((beat) => [beat, [...(boards[beat] ?? []), ...(round.generator[beat] ?? [])]]),
    ),
    curator: [...round.curator],
  };
}

/** Writes `<role>.json` per role into `dir` (created); returns `dir`. */
export function writeDryRunDir(fixtures: DryRunFixtures, dir: string): string {
  mkdirSync(dir, { recursive: true });
  for (const [role, recording] of Object.entries(fixtures)) {
    writeFileSync(join(dir, `${role}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  }
  return dir;
}
