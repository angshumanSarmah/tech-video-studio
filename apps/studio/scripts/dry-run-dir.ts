import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '#core/config.ts';
import { topicDryRunFixtures, writeDryRunDir } from '#worker/agents/fixture-dry-run.ts';
import {
  FIXTURE_TOPIC_IDS,
  FIXTURE_WORDS_PER_SEC,
  fixtureTopic,
  type FixtureTopicId,
} from '#worker/agents/fixture-topics.ts';

/**
 * `pnpm --filter @explainer-studio/studio dry-run:dir [--topic <id>]`: writes a fixture topic's
 * recordings into `<DATA_DIR>/dry-run/<topic>/` and prints the studio CLI command that runs the
 * topic from its invented sources with them (no API calls; real Kokoro and Remotion).
 */

const { values } = parseArgs({ options: { topic: { type: 'string', default: 'tokenizer' } } });
const topic = values.topic as FixtureTopicId;
if (!FIXTURE_TOPIC_IDS.includes(topic)) {
  console.error(`--topic takes one of: ${FIXTURE_TOPIC_IDS.join(', ')}`);
  process.exit(2);
}

const config = loadConfig();
const dir = writeDryRunDir(topicDryRunFixtures(topic), join(config.dataDir, 'dry-run', topic));
const fixture = fixtureTopic(topic);
const series = fixture.seriesTag === 'ai' ? 'ai' : 'system-design';
const sources = fixture.sourceFiles.map((f) => `--source ${JSON.stringify(f)}`).join(' \\\n  ');

console.log(`Recordings for ${topic} written to ${dir}\n`);
console.log(
  `pnpm studio run ${JSON.stringify(fixture.topic.title)} --series ${series} \\\n` +
    `  ${sources} \\\n` +
    `  --angle ${JSON.stringify(fixture.topic.notes)} \\\n` +
    `  --words-per-sec ${FIXTURE_WORDS_PER_SEC} --auto --dry-run ${JSON.stringify(dir)}`,
);
