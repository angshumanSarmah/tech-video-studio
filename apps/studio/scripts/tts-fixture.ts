/**
 * `pnpm --filter @explainer-studio/studio tts:fixture`: synthesises the rate-limiter fixture's
 * narration, one WAV per beat, through the real provider (cache included), and checks every word
 * list. For each beat it writes, under <DATA_DIR>/tts/fixture/rate-limiter/:
 *   <beat>.wav, <beat>.words.json and <beat>.labels.txt (an Audacity label track: File > Import >
 *   Labels, for spot-checking that words land on audible speech).
 * Then it renders one sentence in each sample voice to <DATA_DIR>/tts/voice-samples/<voice>.wav.
 * Run it twice: the second run is served from the cache without starting Python.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import type { TimedWord } from '@explainer-studio/shared';
import { loadConfig } from '#core/config.ts';
import { ttsVoiceSamplesDir } from '#core/data-files.ts';
import { createKokoroTts } from '#worker/tts/kokoro.ts';
import { resolveTtsOptions } from '#worker/tts/options.ts';
import type { TtsProvider } from '#worker/tts/provider.ts';
import { wordTimingProblems } from '#worker/tts/word-checks.ts';

/** Invented sample line; uses two dictionary words. */
const SAMPLE_SENTENCE =
  'Redis keeps hot keys in memory, so most reads never have to wait on PostgreSQL.';

/** US and UK, female and male (the voices pinned in models.lock.json). */
const SAMPLE_VOICES = [
  { voice: 'af_heart', label: 'US female' },
  { voice: 'af_bella', label: 'US female' },
  { voice: 'am_michael', label: 'US male' },
  { voice: 'bf_emma', label: 'UK female' },
  { voice: 'bm_george', label: 'UK male' },
] as const;

/** Audacity label track: start, end and text, tab-separated, one line per word. */
function audacityLabels(words: readonly TimedWord[]): string {
  return words.map((w) => `${w.startSec.toFixed(4)}\t${w.endSec.toFixed(4)}\t${w.text}\n`).join('');
}

async function synthesizeFixture(
  provider: TtsProvider,
  outDir: string,
  options: { voice: string; speed: number },
): Promise<{ hits: number; failures: number }> {
  let hits = 0;
  let failures = 0;
  mkdirSync(outDir, { recursive: true });
  for (const beat of rateLimiterSpec.script) {
    const started = performance.now();
    const result = await provider.synthesize(beat.narration, options.voice, options.speed);
    const ms = Math.round(performance.now() - started);
    const problems = wordTimingProblems(beat.narration, result.words, result.durationSec);
    if (result.cached) hits++;
    if (problems.length) failures++;
    copyFileSync(result.wavPath, join(outDir, `${beat.beatId}.wav`));
    writeFileSync(
      join(outDir, `${beat.beatId}.words.json`),
      `${JSON.stringify(result.words, null, 2)}\n`,
    );
    writeFileSync(join(outDir, `${beat.beatId}.labels.txt`), audacityLabels(result.words));
    const status = problems.length ? `FAIL ${problems.join('; ')}` : 'ok';
    console.log(
      `  ${beat.beatId.padEnd(14)} ${result.cached ? 'hit ' : 'miss'} ${String(result.words.length).padStart(3)} words` +
        `  ${result.durationSec.toFixed(2).padStart(6)} s audio  ${String(ms).padStart(5)} ms  ${status}`,
    );
  }
  return { hits, failures };
}

async function renderVoiceSamples(provider: TtsProvider, outDir: string, speed: number) {
  mkdirSync(outDir, { recursive: true });
  for (const { voice, label } of SAMPLE_VOICES) {
    const result = await provider.synthesize(SAMPLE_SENTENCE, voice, speed);
    copyFileSync(result.wavPath, join(outDir, `${voice}.wav`));
    console.log(`  ${voice.padEnd(11)} ${label.padEnd(10)} ${result.cached ? 'hit ' : 'miss'}`);
  }
}

async function main(): Promise<number> {
  const config = loadConfig();
  const { voice, speed } = resolveTtsOptions(undefined, config.tts);
  const tts = createKokoroTts({
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    python: config.tts.binaryPath,
    log: (message) => console.warn(`[tts] ${message}`),
  });
  const fixtureDir = join(config.dataDir, 'tts', 'fixture', 'rate-limiter');
  const samplesDir = join(config.dataDir, ttsVoiceSamplesDir());
  try {
    console.log(`rate-limiter fixture (voice ${voice}, speed ${speed})`);
    const beats = rateLimiterSpec.script.length;
    const { hits, failures } = await synthesizeFixture(tts.provider, fixtureDir, { voice, speed });
    console.log(
      `  ${hits}/${beats} beats from cache -> ${relative(config.workspaceRoot, fixtureDir)}`,
    );
    console.log(`voice samples (speed ${speed}): "${SAMPLE_SENTENCE}"`);
    await renderVoiceSamples(tts.provider, samplesDir, speed);
    console.log(`  -> ${relative(config.workspaceRoot, samplesDir)}`);
    return failures ? 1 : 0;
  } finally {
    await tts.provider.close();
  }
}

process.exitCode = await main();
