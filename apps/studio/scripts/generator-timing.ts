/**
 * `pnpm --filter @explainer-studio/studio generator:timing [--topic <topic>]`: synthesises every
 * beat of the topic's recorded script with Kokoro (the app's voice and speed, cache included; needs
 * `pnpm tts:setup`) and writes the word times to the committed timing fixture
 * (`agents/generator/fixtures/<topic>/timing.json`), which `generator:fixture` and the job tests
 * read instead of running Python. Re-run it after re-recording the Scriptwriter.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { validateVideoSpec } from '@explainer-studio/shared';
import { loadConfig } from '#core/config.ts';
import { fixtureScriptedSpec } from '#worker/agents/generator/testing.ts';
import {
  timingFixturePath,
  TimingFixtureSchema,
  type TimingFixture,
} from '#worker/agents/generator/timing-fixture.ts';
import { createKokoroTts } from '#worker/tts/kokoro.ts';
import { wordTimingProblems } from '#worker/tts/word-checks.ts';
import { topicArg } from './agent-fixture.ts';

async function main(): Promise<number> {
  const config = loadConfig();
  const topic = topicArg(process.argv);
  const { voice, speed } = config.tts;
  const spec = validateVideoSpec(fixtureScriptedSpec(topic.id)).spec;
  if (!spec?.script) throw new Error(`The ${topic.id} plan and script do not assemble.`);
  const tts = createKokoroTts({
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    python: config.tts.binaryPath,
    log: (message) => console.warn(`[tts] ${message}`),
  });
  try {
    console.log(`${topic.id} timing (voice ${voice}, speed ${speed})`);
    const beats: TimingFixture['beats'] = [];
    let failures = 0;
    for (const beat of spec.script) {
      const result = await tts.provider.synthesize(beat.narration, voice, speed);
      const problems = wordTimingProblems(beat.narration, result.words, result.durationSec);
      failures += problems.length > 0 ? 1 : 0;
      beats.push({
        beatId: beat.beatId,
        narration: beat.narration,
        durationSec: result.durationSec,
        words: result.words,
      });
      const status = problems.length ? `FAIL ${problems.join('; ')}` : 'ok';
      console.log(
        `  ${beat.beatId.padEnd(8)} ${result.cached ? 'hit ' : 'miss'} ${String(result.words.length).padStart(3)} words ${result.durationSec.toFixed(2).padStart(6)} s  ${status}`,
      );
    }
    if (failures > 0) return 1;
    const path = timingFixturePath(topic.id);
    mkdirSync(dirname(path), { recursive: true });
    const fixture = TimingFixtureSchema.parse({ voice, speed, beats });
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`  -> ${relative(config.workspaceRoot, path)}`);
    return 0;
  } finally {
    await tts.provider.close();
  }
}

process.exitCode = await main();
