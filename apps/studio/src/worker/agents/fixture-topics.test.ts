import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SERIES } from '#core/db/seed.ts';
import {
  FIXTURE_TOPIC_IDS,
  fixtureResponsesDir,
  fixtureTopic,
  hasRecordedResponses,
} from './fixture-topics.ts';

describe('fixture topics', () => {
  it.each(FIXTURE_TOPIC_IDS)('%s has readable invented sources in a seeded series', (id) => {
    const topic = fixtureTopic(id);
    expect(topic.sourceFiles.length).toBeGreaterThanOrEqual(2);
    for (const file of topic.sourceFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text).toMatch(/^_Invented .*Explainer Studio test fixtures/m);
      expect(text.length).toBeGreaterThan(1_000);
    }
    expect(DEFAULT_SERIES.map((s) => s.tag)).toContain(topic.seriesTag);
  });

  it('finds recorded answers per role and topic', () => {
    expect(hasRecordedResponses('director', 'rate-limiter')).toBe(true);
    expect(fixtureResponsesDir('scriptwriter', 'tokenizer')).toMatch(
      /scriptwriter\/fixtures\/tokenizer\/responses$/,
    );
  });
});
