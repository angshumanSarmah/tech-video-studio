/**
 * `pnpm --filter @explainer-studio/studio tts:fixture [--no-render]`: narrates the rate-limiter
 * fixture through the real provider (cache included) and the timing step, then renders a draft
 * with the narration to check sync by eye. Under <DATA_DIR>/tts/fixture/rate-limiter/:
 *   <beat>.wav, <beat>.words.json and <beat>.labels.txt (an Audacity label track: File > Import >
 *   Labels, for spot-checking that words land on audible speech);
 *   narration.wav, narration.labels.txt (every word on the whole track) and timed-spec.json, timed
 *   with `settings.timing` (gap, landing hold, tail);
 *   subtitles.srt (the cues the video burns in, as the final export writes them);
 *   draft.mp4 (skipped with --no-render).
 * Then it renders one sentence in each sample voice to <DATA_DIR>/tts/voice-samples/<voice>.wav.
 * Run it twice: the second run is served from the cache without starting Python.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  fixtureChannelHandle,
  fixtureSeries,
  rateLimiterSpec,
} from '@explainer-studio/renderer/fixtures';
import {
  validateRenderableVideoSpec,
  type TimedWord,
  type TimingSettings,
} from '@explainer-studio/shared';
import { loadConfig, type AppConfig } from '#core/config.ts';
import { ttsVoiceSamplesDir } from '#core/data-files.ts';
import { renderDraft } from '#worker/render/draft.ts';
import { runFfmpeg } from '#worker/render/ffmpeg.ts';
import { writeSubtitles } from '#worker/render/srt.ts';
import type { RenderTarget } from '#worker/render/target.ts';
import { createRemotionEngine } from '#worker/render/remotion-engine.ts';
import { resolveTimingOptions } from '#worker/timing/assemble.ts';
import { timeNarration, type NarratedBeat } from '#worker/timing/step.ts';
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

interface FixtureNarration {
  readonly beats: NarratedBeat[];
  readonly hits: number;
  readonly failures: number;
}

async function synthesizeFixture(
  provider: TtsProvider,
  outDir: string,
  options: { voice: string; speed: number },
): Promise<FixtureNarration> {
  const beats: NarratedBeat[] = [];
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
    beats.push({ ...result, beatId: beat.beatId, wav: readFileSync(result.wavPath) });
    const status = problems.length ? `FAIL ${problems.join('; ')}` : 'ok';
    console.log(
      `  ${beat.beatId.padEnd(14)} ${result.cached ? 'hit ' : 'miss'} ${String(result.words.length).padStart(3)} words` +
        `  ${result.durationSec.toFixed(2).padStart(6)} s audio  ${String(ms).padStart(5)} ms  ${status}`,
    );
  }
  return { beats, hits, failures };
}

/** Times the fixture with `pauses`; writes the track, its labels and the timed spec. */
function timeFixture(beats: readonly NarratedBeat[], pauses: TimingSettings, outDir: string) {
  const { timing, track } = timeNarration(rateLimiterSpec, beats, pauses);
  const narrationPath = join(outDir, 'narration.wav');
  writeFileSync(narrationPath, track);
  const spec = { ...rateLimiterSpec, timing: { audioFile: 'narration.wav', ...timing } };
  const result = validateRenderableVideoSpec(spec);
  if (!result.ok) throw new Error(`Timed fixture is invalid: ${JSON.stringify(result.errors)}`);
  writeFileSync(join(outDir, 'timed-spec.json'), `${JSON.stringify(result.spec, null, 2)}\n`);
  writeFileSync(
    join(outDir, 'narration.labels.txt'),
    audacityLabels(timing.beats.flatMap((b) => b.words)),
  );
  for (const [i, beat] of timing.beats.entries()) {
    const next = timing.beats[i + 1]?.startSec ?? timing.endSec ?? beat.endSec;
    const hold = (next - beat.endSec).toFixed(2);
    console.log(
      `  ${beat.beatId.padEnd(14)} ${beat.startSec.toFixed(2).padStart(6)}-${beat.endSec.toFixed(2)} s, then ${hold} s held`,
    );
  }
  return { spec: result.spec, narrationPath };
}

function fixtureTarget(timed: ReturnType<typeof timeFixture>): RenderTarget {
  return {
    spec: timed.spec,
    props: { series: fixtureSeries, channelHandle: fixtureChannelHandle },
    audioPath: timed.narrationPath,
  };
}

async function renderFixtureDraft(
  config: AppConfig,
  timed: ReturnType<typeof timeFixture>,
  outDir: string,
): Promise<string> {
  const tools = { engine: createRemotionEngine(), ffmpeg: runFfmpeg, settings: config.render };
  const joined = join(outDir, 'draft.mp4');
  await renderDraft(
    fixtureTarget(timed),
    tools,
    { signal: new AbortController().signal, onProgress: () => undefined },
    {
      clip: (beatId) => join(outDir, 'beats', `${beatId}.draft.mp4`),
      meta: (beatId) => join(outDir, 'beats', `${beatId}.draft.json`),
      joined,
    },
  );
  return joined;
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
  const render = !process.argv.includes('--no-render');
  const { voice, speed } = resolveTtsOptions(undefined, config.tts);
  const pauses = resolveTimingOptions(undefined, config.timing);
  const tts = createKokoroTts({
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    python: config.tts.binaryPath,
    log: (message) => console.warn(`[tts] ${message}`),
  });
  const fixtureDir = join(config.dataDir, 'tts', 'fixture', 'rate-limiter');
  const samplesDir = join(config.dataDir, ttsVoiceSamplesDir());
  const shown = (path: string) => relative(config.workspaceRoot, path);
  try {
    console.log(`rate-limiter fixture (voice ${voice}, speed ${speed})`);
    const narration = await synthesizeFixture(tts.provider, fixtureDir, { voice, speed });
    const count = rateLimiterSpec.script.length;
    console.log(`  ${narration.hits}/${count} beats from cache -> ${shown(fixtureDir)}`);
    console.log(
      `timing (gap ${pauses.beatGapSec} s, landing ${pauses.landingSec} s, tail ${pauses.endTailSec} s)`,
    );
    const timed = timeFixture(narration.beats, pauses, fixtureDir);
    console.log(`  -> ${shown(timed.narrationPath)}, ${timed.spec.timing?.endSec ?? 0} s`);
    const srtPath = join(fixtureDir, 'subtitles.srt');
    const cues = await writeSubtitles(fixtureTarget(timed), srtPath);
    console.log(`  subtitles -> ${shown(srtPath)} (${cues} cues)`);
    if (render)
      console.log(`  draft -> ${shown(await renderFixtureDraft(config, timed, fixtureDir))}`);
    console.log(`voice samples (speed ${speed}): "${SAMPLE_SENTENCE}"`);
    await renderVoiceSamples(tts.provider, samplesDir, speed);
    console.log(`  -> ${shown(samplesDir)}`);
    return narration.failures ? 1 : 0;
  } finally {
    await tts.provider.close();
  }
}

process.exitCode = await main();
