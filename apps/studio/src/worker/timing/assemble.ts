import type { BeatTiming, RunSettings, TimedWord, TimingSettings } from '@explainer-studio/shared';

/** Pauses for a run: each of its `settings.timing` overrides, else the app's `settings.timing`. */
export function resolveTimingOptions(
  run: RunSettings | undefined,
  app: TimingSettings,
): TimingSettings {
  return { ...app, ...run?.timing };
}

/** One beat's synthesised narration: its WAV length and words in seconds from the WAV's start. */
export interface BeatAudio {
  readonly beatId: string;
  readonly durationSec: number;
  readonly words: readonly TimedWord[];
}

export interface AssembledTiming {
  /** Beats on the track: `startSec` is where the beat's WAV starts, `endSec` where it ends. */
  readonly beats: BeatTiming[];
  /** End of the track: last beat, its landing hold and the tail. */
  readonly endSec: number;
}

const round = (sec: number) => Math.round(sec * 1e4) / 1e4;

/**
 * Places beats on the narration track (pure). Each beat's WAV starts where the previous beat's
 * scene ends: its narration end, or `landingSec` after its last event has settled when that is
 * later (only with `landingSec > 0` and a known settled offset), plus `beatGapSec`. The track
 * ends `endTailSec` after the last beat's narration or landing hold. Everything in between is
 * silence the visuals hold through.
 *
 * `settled` is `beatSettledOffsets`: seconds from a beat's start until its last event has played
 * out. Beats without an entry (no scenes yet) get no landing hold.
 */
export function assembleTiming(
  beats: readonly BeatAudio[],
  pauses: TimingSettings,
  settled: ReadonlyMap<string, number> = new Map(),
): AssembledTiming {
  const placed: BeatTiming[] = [];
  let sceneEnd = 0;
  for (const [i, beat] of beats.entries()) {
    const startSec = i === 0 ? 0 : sceneEnd + pauses.beatGapSec;
    const endSec = startSec + beat.durationSec;
    placed.push({
      beatId: beat.beatId,
      startSec: round(startSec),
      endSec: round(endSec),
      words: beat.words.map((w) => ({
        text: w.text,
        startSec: round(startSec + w.startSec),
        endSec: round(startSec + w.endSec),
      })),
    });
    sceneEnd = Math.max(endSec, landingEnd(beat.beatId, startSec, pauses, settled));
  }
  return { beats: placed, endSec: round(sceneEnd + pauses.endTailSec) };
}

/** Where a beat's landing hold ends (0 when it has none). */
function landingEnd(
  beatId: string,
  startSec: number,
  pauses: TimingSettings,
  settled: ReadonlyMap<string, number>,
): number {
  const offset = settled.get(beatId);
  if (pauses.landingSec <= 0 || offset === undefined) return 0;
  return startSec + offset + pauses.landingSec;
}
