import { beatSettledOffsets } from '@explainer-studio/renderer/catalog';
import type {
  RenderableVideoSpec,
  TimingLayer,
  TimingSettings,
  VideoSpec,
} from '@explainer-studio/shared';
import { resolveEventTimes } from './anchors.ts';
import { assembleTiming, type AssembledTiming, type BeatAudio } from './assemble.ts';
import { buildNarrationTrack } from './narration-track.ts';

/** A beat's synthesised narration with its WAV bytes. */
export interface NarratedBeat extends BeatAudio {
  readonly wav: Uint8Array;
}

/** The timing step failed: anchors that match no word, or narration missing for a beat. */
export class TimingError extends Error {
  override readonly name = 'TimingError';
  constructor(readonly problems: readonly string[]) {
    super(`Timing failed:\n- ${problems.join('\n- ')}`);
  }
}

export interface TimedNarration {
  /** The timing layer without `audioFile` (the caller names the track's file). */
  readonly timing: Omit<TimingLayer, 'audioFile'>;
  /** The narration track: every beat's WAV at its start, silence for the pauses. */
  readonly track: Uint8Array;
}

/**
 * The timing step (pure): places each beat's narration on one track with the run's pauses,
 * resolves event anchors and builds the track's PCM. `beats` follow the script's order.
 *
 * Landing holds need the beats' settled offsets, which come from the scenes as they render with
 * these word timings: a first pass places beats without landing holds, the offsets are measured
 * on it (they do not depend on where a beat sits), and the second pass adds the holds. A spec
 * without scenes (TTS before the Generator) gets no landing holds; re-time it once scenes exist.
 */
export function timeNarration(
  spec: VideoSpec,
  beats: readonly NarratedBeat[],
  pauses: TimingSettings,
): TimedNarration {
  const missing = (spec.script ?? [])
    .filter((s) => !beats.some((b) => b.beatId === s.beatId))
    .map((s) => `beat "${s.beatId}" has no narration audio`);
  if (missing.length || !beats.length)
    throw new TimingError(missing.length ? missing : ['no beats']);

  const provisional = assembleTiming(beats, pauses);
  const settled = settledOffsets(spec, provisional);
  const placed = settled.size ? assembleTiming(beats, pauses, settled) : provisional;
  const resolved = resolveEventTimes(spec, placed.beats);
  if (resolved.problems.length) throw new TimingError(resolved.problems);

  const track = buildNarrationTrack(
    beats.map((beat, i) => ({ wav: beat.wav, startSec: placed.beats[i]?.startSec ?? 0 })),
    placed.endSec,
  );
  return {
    timing: { beats: placed.beats, events: resolved.events, endSec: placed.endSec, pauses },
    track,
  };
}

/** `beatSettledOffsets` on the spec with the provisional timing; empty without scenes. */
function settledOffsets(spec: VideoSpec, provisional: AssembledTiming): Map<string, number> {
  const { script, scenes } = spec;
  if (!script || !scenes?.length) return new Map();
  const timing = { audioFile: 'provisional.wav', ...provisional, events: [] };
  const renderable: RenderableVideoSpec = { ...spec, script, scenes, timing };
  return beatSettledOffsets(renderable);
}
