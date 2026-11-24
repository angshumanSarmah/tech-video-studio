import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelRole, RunSettingsInput } from '@explainer-studio/shared';

/**
 * Topics the agent fixtures exist for (tests and the `*:fixture` scripts). Each has invented
 * sources under `researcher/fixtures/<topic>/sources/` and, per agent role, recorded answers
 * under `<role>/fixtures/<topic>/responses/<role>.json` once recorded. Not imported by any
 * entrypoint.
 */

const AGENTS_DIR = fileURLToPath(new URL('./', import.meta.url));

export const FIXTURE_TOPIC_IDS = ['rate-limiter', 'tokenizer'] as const;
export type FixtureTopicId = (typeof FIXTURE_TOPIC_IDS)[number];

/** The agent roles of the fixture chain, in pipeline order. */
export const FIXTURE_ROLES = ['researcher', 'director', 'scriptwriter', 'generator'] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number] & ModelRole;

export interface FixtureTopic {
  readonly id: FixtureTopicId;
  readonly topic: { readonly title: string; readonly notes: string };
  readonly seriesTag: string;
  /** The invented sources, uploaded in this order (a fresh DB gives them ids 1, 2, 3). */
  readonly sourceFiles: readonly string[];
}

/** Source file names per topic, in upload order. */
const SOURCES: Readonly<Record<FixtureTopicId, readonly string[]>> = {
  'rate-limiter': [
    'token-bucket-field-guide.md',
    'quotaflow-readme.md',
    'larkspur-checkout-incident.md',
  ],
  tokenizer: ['subword-merges-field-guide.md', 'glyphcut-readme.md', 'token-cost-field-notes.md'],
};

const TOPICS: Readonly<Record<FixtureTopicId, Omit<FixtureTopic, 'id' | 'sourceFiles'>>> = {
  'rate-limiter': {
    topic: {
      title: 'Rate limiters',
      notes: 'Token bucket in a shared store, and what breaks when the store gets slow.',
    },
    seriesTag: 'system-design',
  },
  tokenizer: {
    topic: {
      title: 'How an LLM tokenizer works',
      notes: 'How text becomes tokens: subword merges, the vocabulary, and why counts differ.',
    },
    seriesTag: 'ai',
  },
};

/** The directory holding a topic's invented sources. */
export function fixtureSourcesDir(id: FixtureTopicId): string {
  return join(AGENTS_DIR, 'researcher', 'fixtures', id, 'sources');
}

export function fixtureTopic(id: FixtureTopicId): FixtureTopic {
  const dir = fixtureSourcesDir(id);
  return { id, ...TOPICS[id], sourceFiles: SOURCES[id].map((name) => join(dir, name)) };
}

/** Where a role's recorded answers for a topic live (`loadDryRunFixtures` reads the dir). */
export function fixtureResponsesDir(role: FixtureRole, id: FixtureTopicId): string {
  return join(AGENTS_DIR, role, 'fixtures', id, 'responses');
}

/** Whether a role has recorded answers for a topic. */
export function hasRecordedResponses(role: FixtureRole, id: FixtureTopicId): boolean {
  const dir = fixtureResponsesDir(role, id);
  return existsSync(dir) && readdirSync(dir).includes(`${role}.json`);
}

/**
 * The narration pace the fixture topics' Scriptwriter recordings were made at, before the app
 * default was measured from Kokoro. Their runs pin it, so the recorded scripts stay within their
 * word budgets.
 */
export const FIXTURE_WORDS_PER_SEC = 2.7;

/** A fixture run's settings: `overrides`, with the recordings' pace unless they set one. */
export function fixtureRunSettings(overrides: RunSettingsInput = {}): RunSettingsInput {
  return { ...overrides, video: { wordsPerSec: FIXTURE_WORDS_PER_SEC, ...overrides.video } };
}
