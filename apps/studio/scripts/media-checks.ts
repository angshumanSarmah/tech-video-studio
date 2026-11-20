import { parseWav } from '../src/worker/render/audio.ts';

/**
 * Checks for `bench:render` (pure): a synthetic narration track (a tone while each beat speaks,
 * silence in the gaps), silence detection on decoded PCM, and a comparison of the silences in the
 * source with those in a rendered video. If muxing shifted, cut or padded the narration, the
 * silences would move or appear.
 */

export type Interval = { startSec: number; endSec: number };

const TONE_HZ = 220;
const TONE_AMPLITUDE = 0.3;

/** 16-bit mono PCM WAV bytes. */
export function pcmWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return bytes;
}

/** A tone over each beat's narration, silence elsewhere, up to the last beat's end. */
export function synthNarration(beats: readonly Interval[], sampleRate = 24_000): Uint8Array {
  const endSec = Math.max(0, ...beats.map((b) => b.endSec));
  const samples = new Int16Array(Math.ceil(endSec * sampleRate));
  for (const beat of beats) {
    const from = Math.round(beat.startSec * sampleRate);
    const to = Math.min(samples.length, Math.round(beat.endSec * sampleRate));
    for (let i = from; i < to; i++) {
      samples[i] = Math.round(
        Math.sin((2 * Math.PI * TONE_HZ * i) / sampleRate) * TONE_AMPLITUDE * 32767,
      );
    }
  }
  return pcmWav(samples, sampleRate);
}

/** Samples of a 16-bit mono PCM WAV (as `pcmWav` writes and ffmpeg's `pcm_s16le` decodes). */
export function readMonoPcm(bytes: Uint8Array): { samples: Int16Array; sampleRate: number } {
  const layout = parseWav(bytes);
  if (!layout || layout.blockAlign !== 2) throw new Error('Expected a 16-bit mono PCM WAV.');
  const count = Math.floor((layout.dataEnd - layout.dataStart) / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset + layout.dataStart, count * 2);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true);
  return { samples, sampleRate: layout.byteRate / 2 };
}

/**
 * Runs of near-silence at least `minSec` long, from RMS over `windowSec` windows (a window is
 * silent below `threshold` of full scale). A run reaching the end of the track is included.
 */
export function silentIntervals(
  samples: Int16Array,
  sampleRate: number,
  { windowSec = 0.005, threshold = 0.02, minSec = 0.08 } = {},
): Interval[] {
  const size = Math.max(1, Math.round(windowSec * sampleRate));
  const out: Interval[] = [];
  let start: number | undefined;
  const close = (end: number) => {
    if (start !== undefined && (end - start) / sampleRate >= minSec) {
      out.push({ startSec: start / sampleRate, endSec: end / sampleRate });
    }
    start = undefined;
  };
  for (let i = 0; i < samples.length; i += size) {
    const window = samples.subarray(i, i + size);
    const rms = Math.sqrt(window.reduce((sum, s) => sum + s * s, 0) / window.length) / 32768;
    if (rms < threshold) start ??= i;
    else close(i);
  }
  close(samples.length);
  return out;
}

export type SilenceComparison = { ok: boolean; maxShiftSec: number; message: string };

/**
 * Whether `actual` has the same silences as `expected`, each edge within `toleranceSec`. The
 * last expected silence may run longer in `actual` (the video's tail is padded with silence).
 */
export function compareSilences(
  expected: readonly Interval[],
  actual: readonly Interval[],
  toleranceSec = 0.03,
): SilenceComparison {
  if (expected.length !== actual.length) {
    return {
      ok: false,
      maxShiftSec: Number.POSITIVE_INFINITY,
      message: `expected ${expected.length} silences, found ${actual.length}`,
    };
  }
  let maxShiftSec = 0;
  expected.forEach((e, i) => {
    const a = actual[i]!;
    const last = i === expected.length - 1;
    const endShift = last && a.endSec >= e.endSec ? 0 : Math.abs(a.endSec - e.endSec);
    maxShiftSec = Math.max(maxShiftSec, Math.abs(a.startSec - e.startSec), endShift);
  });
  const ok = maxShiftSec <= toleranceSec;
  const ms = Math.round(maxShiftSec * 1000);
  return { ok, maxShiftSec, message: `${expected.length} silences, max edge shift ${ms} ms` };
}

/** The facts `ffprobe` reports for a rendered MP4 (`probeArgs`). */
export type ProbeFacts = {
  durationSec: number;
  video?: {
    codec: string;
    width: number;
    height: number;
    pixFmt: string;
    fps: string;
    frames: number;
  };
  audio?: { codec: string; sampleRate: number };
};

type ProbeJson = {
  format?: { duration?: string };
  streams?: Record<string, string | number | undefined>[];
};

export function parseProbe(json: string): ProbeFacts {
  const parsed = JSON.parse(json) as ProbeJson;
  const streams = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  return {
    durationSec: Number(parsed.format?.duration ?? Number.NaN),
    ...(v && {
      video: {
        codec: String(v.codec_name),
        width: Number(v.width),
        height: Number(v.height),
        pixFmt: String(v.pix_fmt),
        fps: String(v.r_frame_rate),
        frames: Number(v.nb_frames),
      },
    }),
    ...(a && { audio: { codec: String(a.codec_name), sampleRate: Number(a.sample_rate) } }),
  };
}
