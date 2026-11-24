import type { VideoSettings } from '../config/video.ts';
import { END_TAIL_SEC } from '../spec/effective-timing.ts';
import { narrationWords } from '../spec/narration.ts';
import type { VideoSpec } from '../spec/shape.ts';
import type { BeatTiming, TimingLayer } from '../spec/timing.ts';
import { toJsonPath, type SpecError } from '../spec/validate.ts';

/**
 * Length after TTS (P1C.8): the planned seconds against what the timed narration track takes.
 * A beat's measured length is its scene span (narration, gap and landing hold: what its planned
 * `targetSec` covers); the last beat's excludes the end tail, which no plan counts. Only a spec
 * with a timing layer is measured. Pure.
 * - `beat_over_target`: a beat runs more than `BEAT_OVER_TARGET_RATIO` × its planned seconds.
 * - `video_over_target`: the beats together run more than `VIDEO_OVER_TARGET_RATIO` × the
 *   video's target (the run's fixed length when it has one).
 * - `video_out_of_range`: the whole video (end tail included) is outside the configured range.
 *   Not checked when the run fixes its length: the target check covers it.
 */

/** A beat this much longer than planned reads as padded: it is sent back to the Scriptwriter. */
export const BEAT_OVER_TARGET_RATIO = 1.25;

/** The video may run this much over its target before the gate hears about it. */
export const VIDEO_OVER_TARGET_RATIO = 1.1;

/** How many of the longest beats a `video_over_target` message names. */
const LONGEST_NAMED = 3;

export type TimedLengthContext = {
  /** The run's resolved length range. */
  video: Pick<VideoSettings, 'lengthMinSec' | 'lengthMaxSec'>;
  /** The run's fixed length (`lengthOverrideSec`), when it has one. */
  lengthOverrideSec?: number;
};

export type MeasuredBeat = {
  beatId: string;
  scriptIndex: number;
  targetSec: number;
  spanSec: number;
  /** Measured speaking rate of the beat's narration (words per second). */
  wordsPerSec: number;
};

const round1 = (sec: number) => Math.round(sec * 10) / 10;
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function timedLengthProblems(spec: VideoSpec, ctx: TimedLengthContext): SpecError[] {
  const { timing } = spec;
  if (!timing) return [];
  const beats = measuredBeats(spec, timing);
  return [
    ...beats.flatMap(beatOverTarget),
    ...videoOverTarget(spec, beats, ctx),
    ...videoOutOfRange(timing, ctx),
  ];
}

/** Seconds of video after the last beat that no plan counts: the end tail. */
function endTailSec(timing: TimingLayer): number {
  return timing.pauses?.endTailSec ?? END_TAIL_SEC;
}

function videoEndSec(timing: TimingLayer): number {
  return timing.endSec ?? (timing.beats.at(-1)?.endSec ?? 0) + END_TAIL_SEC;
}

/** Each beat's planned and measured seconds; none before TTS (no timing layer). */
export function measuredBeatLengths(spec: VideoSpec): MeasuredBeat[] {
  return spec.timing ? measuredBeats(spec, spec.timing) : [];
}

function measuredBeats(spec: VideoSpec, timing: TimingLayer): MeasuredBeat[] {
  const script = spec.script ?? [];
  const targets = new Map(spec.story.beats.map((b) => [b.id, b.targetSec]));
  return timing.beats.flatMap((beat, i) => {
    const scriptIndex = script.findIndex((s) => s.beatId === beat.beatId);
    const targetSec = targets.get(beat.beatId);
    if (scriptIndex < 0 || targetSec === undefined) return [];
    const words = narrationWords(script[scriptIndex]?.narration ?? '').length;
    const speechSec = Math.max(beat.endSec - beat.startSec, 1e-6);
    const spanSec = spanOf(timing, beat, timing.beats[i + 1]);
    return [
      { beatId: beat.beatId, scriptIndex, targetSec, spanSec, wordsPerSec: words / speechSec },
    ];
  });
}

/** Until the next beat starts; the last beat until the video ends, less the end tail. */
function spanOf(timing: TimingLayer, beat: BeatTiming, next: BeatTiming | undefined): number {
  const end = next
    ? next.startSec
    : Math.max(beat.endSec, videoEndSec(timing) - endTailSec(timing));
  return end - beat.startSec;
}

function beatOverTarget(beat: MeasuredBeat): SpecError[] {
  const ratio = beat.spanSec / beat.targetSec;
  if (ratio <= BEAT_OVER_TARGET_RATIO) return [];
  const cut = Math.ceil((beat.spanSec - beat.targetSec) * beat.wordsPerSec);
  return [
    {
      path: toJsonPath(['script', beat.scriptIndex, 'narration']),
      code: 'beat_over_target',
      message:
        `Beat ${beat.beatId} runs ${round1(beat.spanSec)} s against its planned ` +
        `${beat.targetSec} s (${percent(ratio)}; more than ${percent(BEAT_OVER_TARGET_RATIO)} ` +
        `is too long). Cut about ${cut} words: it is read at ` +
        `${round1(beat.wordsPerSec)} words a second, and spoken numbers take longer than they look.`,
    },
  ];
}

function videoOverTarget(
  spec: VideoSpec,
  beats: readonly MeasuredBeat[],
  ctx: TimedLengthContext,
): SpecError[] {
  const target = ctx.lengthOverrideSec ?? spec.meta.targetLengthSec;
  const total = beats.reduce((sum, b) => sum + b.spanSec, 0);
  if (total <= target * VIDEO_OVER_TARGET_RATIO) return [];
  const longest = [...beats]
    .filter((b) => b.spanSec > b.targetSec)
    .sort((a, b) => b.spanSec - b.targetSec - (a.spanSec - a.targetSec))
    .slice(0, LONGEST_NAMED)
    .map((b) => `${b.beatId} +${round1(b.spanSec - b.targetSec)} s`);
  return [
    {
      path: toJsonPath(['script']),
      code: 'video_over_target',
      message:
        `The beats run ${round1(total)} s against the video's ${target} s target ` +
        `(${percent(total / target)}). Most over their plan: ${longest.join(', ')}.`,
    },
  ];
}

function videoOutOfRange(timing: TimingLayer, ctx: TimedLengthContext): SpecError[] {
  if (ctx.lengthOverrideSec !== undefined) return [];
  const { lengthMinSec: min, lengthMaxSec: max } = ctx.video;
  const length = videoEndSec(timing);
  if (length >= min && length <= max) return [];
  const fix = length > max ? 'Shorten the narration' : 'The narration is too short: lengthen it';
  return [
    {
      path: toJsonPath(['script']),
      code: 'video_out_of_range',
      message: `The video runs ${round1(length)} s, outside the configured ${min}–${max} s. ${fix}.`,
    },
  ];
}
