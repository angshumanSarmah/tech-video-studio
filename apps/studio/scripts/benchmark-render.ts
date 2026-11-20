import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beatFrameSpans, totalFrames } from '@explainer-studio/renderer/catalog';
import {
  fixtureChannelHandle,
  fixtureSeries,
  rateLimiterSpec,
} from '@explainer-studio/renderer/fixtures';
import {
  effectiveTiming,
  type RenderableVideoSpec,
  type RenderSettings,
} from '@explainer-studio/shared';
import { loadConfig } from '#core/config.ts';
import { getRendererBundle } from '#worker/render/bundle.ts';
import { renderDraft, spanSeconds, type DraftPaths } from '#worker/render/draft.ts';
import { probeArgs } from '#worker/render/ffmpeg-args.ts';
import { ffmpegVersion, runFf, runFfmpeg } from '#worker/render/ffmpeg.ts';
import { renderFinal } from '#worker/render/final.ts';
import { createRemotionEngine } from '#worker/render/remotion-engine.ts';
import { renderStills } from '#worker/render/stills.ts';
import type { RenderRun, RenderTarget, RenderTools } from '#worker/render/target.ts';
import {
  compareSilences,
  parseProbe,
  readMonoPcm,
  silentIntervals,
  synthNarration,
  type ProbeFacts,
} from './media-checks.ts';
import { startMemorySampler } from './process-memory.ts';

/**
 * Renders the rate-limiter fixture through the render service and prints timings and peak
 * memory (RSS of this process and everything it spawns: Chrome, the compositor, ffmpeg):
 * bundle, a cold draft, a draft after editing one beat (must re-render only that beat), an
 * unchanged draft (all clips reused), the final, and stills. A synthetic narration track (a tone
 * while each beat speaks) goes through the real mux path; the outputs are then checked with
 * ffprobe and by comparing their silences with the source's (no gaps, no shifts, no cuts).
 *
 * Usage: pnpm --filter @explainer-studio/studio bench:render [--concurrency N]
 * Outputs: <DATA_DIR>/bench/ (replaced on every run).
 */

const AUDIO_RATE = 24_000;
const EDITED_BEAT = 'payoff';

type Row = { phase: string; seconds: number; peakMb: number; note: string };
type Check = { name: string; ok: boolean; detail: string };

const rows: Row[] = [];
const checks: Check[] = [];

await checkFfmpeg();
const config = loadConfig();
const settings: RenderSettings = {
  ...config.render,
  concurrency: concurrencyArg() ?? config.render.concurrency,
};
const outDir = join(config.dataDir, 'bench');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const timing = effectiveTiming(rateLimiterSpec);
const narrationPath = join(outDir, 'narration.wav');
writeFileSync(narrationPath, synthNarration(timing.beats, AUDIO_RATE));

const tools: RenderTools = { engine: createRemotionEngine(), ffmpeg: runFfmpeg, settings };
const paths: DraftPaths = {
  clip: (beatId) => join(outDir, 'beats', `${beatId}.draft.mp4`),
  meta: (beatId) => join(outDir, 'beats', `${beatId}.draft.json`),
  joined: join(outDir, 'draft.mp4'),
};
const finalPath = join(outDir, 'final.mp4');
const target = (spec: RenderableVideoSpec): RenderTarget => ({
  spec,
  props: { series: fixtureSeries, channelHandle: fixtureChannelHandle },
  audioPath: narrationPath,
});

const memory = startMemorySampler();
console.log(
  `Fixture: rate-limiter, ${timing.beats.length} beats, ${timing.endSec.toFixed(2)} s · ` +
    `draft ${preset('draft')} · final ${preset('final')} · concurrency ${settings.concurrency}`,
);

await phase('bundle', async () => {
  await getRendererBundle();
  return "once per worker process (webpack's disk cache may be warm)";
});

await phase('draft (cold)', async (run) => {
  const r = await renderDraft(target(rateLimiterSpec), tools, run, paths);
  return `rendered ${r.rendered.length} beats, ${r.frames} frames`;
});

await phase(`draft (${EDITED_BEAT} edited)`, async (run) => {
  const r = await renderDraft(target(editedSpec()), tools, run, paths);
  expect(
    'one-beat edit re-renders only that beat',
    r.rendered.join(',') === EDITED_BEAT,
    `rendered [${r.rendered.join(', ')}], reused ${r.reused.length}`,
  );
  return `rendered [${r.rendered.join(', ')}], reused ${r.reused.length}`;
});

await phase('draft (unchanged)', async (run) => {
  const r = await renderDraft(target(editedSpec()), tools, run, paths);
  expect(
    'unchanged draft reuses every clip',
    r.rendered.length === 0,
    `rendered ${r.rendered.length}`,
  );
  return `reused ${r.reused.length} clips (join + mux only)`;
});

await phase('final', async (run) => {
  const subtitles = finalPath.replace(/\.mp4$/, '.srt');
  const r = await renderFinal(target(editedSpec()), tools, run, { video: finalPath, subtitles });
  return `${r.frames} frames, ${r.cues} subtitle cues`;
});

await phase('stills', async (run) => {
  const frames = await renderStills(target(editedSpec()), tools, run, {
    still: (b) => join(outDir, 'stills', `${b}.png`),
    manifest: join(outDir, 'stills', 'stills.json'),
  });
  return `${Object.keys(frames).length} PNGs`;
});

const overallPeak = await memory.stop();
await verifyOutputs();
printReport(overallPeak);
process.exit(checks.every((c) => c.ok) ? 0 : 1);

// ---------------------------------------------------------------------------------------------

async function checkFfmpeg(): Promise<void> {
  try {
    console.log(`ffmpeg (Remotion bundled): ${await ffmpegVersion()}`);
  } catch (error) {
    console.error(
      'ffmpeg check failed: the adapter could not run `ffmpeg -version` through ' +
        '@remotion/renderer (apps/studio/src/worker/render/ffmpeg.ts). A Remotion upgrade may have ' +
        `changed RenderInternals.callFf.\n${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

async function phase(name: string, fn: (run: RenderRun) => Promise<string>): Promise<void> {
  memory.reset();
  const started = performance.now();
  let lastTenth = -1;
  const run: RenderRun = {
    signal: new AbortController().signal,
    onProgress: (fraction) => {
      const tenth = Math.floor(fraction * 10);
      if (tenth > lastTenth) {
        lastTenth = tenth;
        process.stdout.write(`\r  ${name}: ${tenth * 10}%   `);
      }
    },
  };
  const note = await fn(run);
  const seconds = (performance.now() - started) / 1000;
  process.stdout.write(`\r  ${name}: done in ${seconds.toFixed(1)} s\n`);
  rows.push({ phase: name, seconds, peakMb: memory.peakMb(), note });
}

function expect(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function editedSpec(): RenderableVideoSpec {
  return {
    ...rateLimiterSpec,
    scenes: rateLimiterSpec.scenes.map((s) =>
      s.beatId === EDITED_BEAT
        ? { ...s, elements: s.elements.map((e) => ({ ...e, props: { text: 'slowed down' } })) }
        : s,
    ),
  };
}

async function verifyOutputs(): Promise<void> {
  const draftFps = settings.presets.draft.fps;
  const finalFps = settings.presets.final.fps;
  await verifyVideo('draft', paths.joined, settings.presets.draft, totalFrames(timing, draftFps));
  await verifyVideo('final', finalPath, settings.presets.final, totalFrames(timing, finalFps));
  await verifySilences(
    'draft narration',
    paths.joined,
    0,
    totalFrames(timing, draftFps) / draftFps,
  );
  await verifySilences('final narration', finalPath, 0, totalFrames(timing, finalFps) / finalFps);
  const span = beatFrameSpans(timing, draftFps).find((s) => s.beatId === 'bucket-empty')!;
  const { startSec, durationSec } = spanSeconds(span, draftFps);
  await verifySilences(
    'beat clip slice (bucket-empty)',
    paths.clip('bucket-empty'),
    startSec,
    durationSec,
  );
  expect('faststart (moov before mdat)', moovFirst(finalPath), 'final.mp4');
}

async function verifyVideo(
  label: string,
  path: string,
  p: { width: number; height: number; fps: number },
  frames: number,
): Promise<void> {
  const facts: ProbeFacts = parseProbe(await runFf('ffprobe', probeArgs(path)));
  const v = facts.video;
  const a = facts.audio;
  const want = `h264 ${p.width}x${p.height} yuv420p ${p.fps}/1 ${frames} frames, aac 48000`;
  const got = `${v?.codec} ${v?.width}x${v?.height} ${v?.pixFmt} ${v?.fps} ${v?.frames} frames, ${a?.codec} ${a?.sampleRate}`;
  expect(`${label} streams`, want === got, got);
  const drift = Math.abs(facts.durationSec - frames / p.fps);
  expect(
    `${label} duration`,
    drift < 0.05,
    `${facts.durationSec.toFixed(3)} s vs ${(frames / p.fps).toFixed(3)} s of video`,
  );
}

/** Decodes the output's audio and compares its silences with the source's over the same range. */
async function verifySilences(label: string, path: string, startSec: number, durationSec: number) {
  const decoded = join(outDir, 'decoded.wav');
  await runFfmpeg([
    '-y',
    '-loglevel',
    'error',
    '-i',
    path,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(AUDIO_RATE),
    '-c:a',
    'pcm_s16le',
    decoded,
  ]);
  const source = readMonoPcm(readFileSync(narrationPath)).samples;
  const expected = new Int16Array(Math.round(durationSec * AUDIO_RATE));
  expected.set(
    source.subarray(
      Math.round(startSec * AUDIO_RATE),
      Math.round((startSec + durationSec) * AUDIO_RATE),
    ),
  );
  const actual = readMonoPcm(readFileSync(decoded));
  rmSync(decoded);
  const result = compareSilences(
    silentIntervals(expected, AUDIO_RATE),
    silentIntervals(actual.samples, actual.sampleRate),
  );
  expect(`${label}: silences match source`, result.ok, result.message);
  const audioSec = actual.samples.length / actual.sampleRate;
  expect(
    `${label}: audio covers the video`,
    audioSec >= durationSec - 0.03,
    `${audioSec.toFixed(3)} s of ${durationSec.toFixed(3)} s`,
  );
}

/** Top-level MP4 boxes: `moov` must come before `mdat` for `+faststart`. */
function moovFirst(path: string): boolean {
  const bytes = readFileSync(path);
  const order: string[] = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    order.push(bytes.toString('latin1', offset + 4, offset + 8));
    if (size < 8) break;
    offset += size;
  }
  return order.indexOf('moov') >= 0 && order.indexOf('moov') < order.indexOf('mdat');
}

function preset(name: 'draft' | 'final'): string {
  const p = settings.presets[name];
  return `${p.width}x${p.height}@${p.fps}`;
}

function concurrencyArg(): number | undefined {
  const i = process.argv.indexOf('--concurrency');
  const value = i >= 0 ? Number(process.argv[i + 1]) : undefined;
  return value && Number.isInteger(value) && value > 0 ? value : undefined;
}

function printReport(overallPeakMb: number): void {
  console.log('\nphase                    time (s)   peak RSS (MB)   notes');
  for (const r of rows) {
    console.log(
      `${r.phase.padEnd(24)} ${r.seconds.toFixed(1).padStart(8)}   ${r.peakMb.toFixed(0).padStart(13)}   ${r.note}`,
    );
  }
  console.log(
    `${'overall peak'.padEnd(24)} ${''.padStart(8)}   ${overallPeakMb.toFixed(0).padStart(13)}`,
  );
  console.log('\nchecks');
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  console.log(`\nOutputs in ${outDir}`);
}
