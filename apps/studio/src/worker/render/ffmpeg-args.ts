/**
 * ffmpeg argument builders (pure; run through `ffmpeg.ts`). Video is always copied, never
 * re-encoded: Remotion already wrote H.264 yuv420p at the preset's size and fps
 * (`encoding.ts`). Only audio is encoded here.
 */

/** AAC at 48 kHz, as the final MP4 requires; drafts use the same so clips and exports match. */
export const AUDIO_CODEC = 'aac';
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_BITRATE = '192k';

/** A narration slice: `durationSec` of `path` from `startSec`. */
export type AudioSlice = { path: string; startSec: number };

export interface MuxArgs {
  /** Silent video from Remotion. */
  readonly videoPath: string;
  /** Narration to lay under it from frame 0, or null for a silent output. */
  readonly audio: AudioSlice | null;
  /** The video's exact length; audio is padded with silence or cut to it. */
  readonly durationSec: number;
  readonly outPath: string;
}

/** Seconds as ffmpeg reads them, without float noise (`1.2000000000000002`). */
export function ffSec(sec: number): string {
  return (Math.round(sec * 1e6) / 1e6).toString();
}

/**
 * Lays the narration (or a slice of it) under a silent video: the video stream is copied, the
 * audio is cut at `audio.startSec`, padded with silence to the video's length and encoded as AAC
 * 48 kHz. `+faststart` moves the index to the front so the file plays while it loads. Without
 * audio it only remuxes (for `+faststart`).
 */
export function muxArgs({ videoPath, audio, durationSec, outPath }: MuxArgs): string[] {
  const head = ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoPath];
  const tail = ['-movflags', '+faststart', outPath];
  if (!audio) return [...head, '-map', '0:v:0', '-c:v', 'copy', ...tail];
  return [
    ...head,
    ...['-ss', ffSec(audio.startSec), '-i', audio.path],
    ...['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'],
    ...['-af', 'apad', '-c:a', AUDIO_CODEC, '-ar', String(AUDIO_SAMPLE_RATE)],
    ...['-b:a', AUDIO_BITRATE, '-t', ffSec(durationSec)],
    ...tail,
  ];
}

/** The concat demuxer's list file: one `file '<path>'` line per clip, quotes escaped. */
export function concatListText(paths: readonly string[]): string {
  return paths.map((p) => `file '${p.replaceAll("'", "'\\''")}'\n`).join('');
}

/**
 * Joins clips with the concat demuxer, copying their video streams only: each clip's own audio
 * slice is dropped, and the joined draft gets the whole narration in one piece afterwards, so AAC
 * padding at clip edges can never drift it.
 */
export function concatArgs(listPath: string, outPath: string): string[] {
  return [
    ...['-y', '-hide_banner', '-loglevel', 'error'],
    ...['-f', 'concat', '-safe', '0', '-i', listPath],
    ...['-map', '0:v:0', '-c', 'copy', outPath],
  ];
}

const PROBE_STREAM_FIELDS = [
  'codec_type',
  'codec_name',
  'width',
  'height',
  'pix_fmt',
  'sample_rate',
  'r_frame_rate',
  'nb_frames',
];

/** Stream facts for checks and the benchmark (`ffprobe`, JSON). */
export function probeArgs(path: string): string[] {
  return [
    ...['-v', 'error', '-print_format', 'json'],
    '-show_entries',
    `format=duration:stream=${PROBE_STREAM_FIELDS.join(',')}`,
    path,
  ];
}
