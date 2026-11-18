import {
  narrationWords,
  resolveAnchorSec,
  type BeatScene,
  type BeatTiming,
  type EffectiveTiming,
  type EventAction,
  type EventAnchor,
} from '@explainer-studio/shared';

/**
 * Seconds (the spec's unit) to frames (the composition's unit). The spec never stores frames, so
 * the same spec renders at the draft and final presets' frame rates.
 */
export function secToFrame(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

/** Length of the whole video in frames, including the tail after the last beat. */
export function totalFrames(timing: EffectiveTiming, fps: number): number {
  return Math.max(1, Math.ceil(timing.endSec * fps));
}

export type BeatFrameSpan = { beatId: string; from: number; durationInFrames: number };

/**
 * One span per beat that tiles the video without gaps: the first starts at frame 0, each runs until
 * the next beat starts (so silences between beats keep the previous scene), the last runs to the end.
 */
export function beatFrameSpans(timing: EffectiveTiming, fps: number): BeatFrameSpan[] {
  const total = totalFrames(timing, fps);
  const starts = timing.beats.map((beat, i) => (i === 0 ? 0 : secToFrame(beat.startSec, fps)));
  return timing.beats.map((beat, i) => {
    const from = starts[i] ?? 0;
    const to = starts[i + 1] ?? total;
    return { beatId: beat.beatId, from, durationInFrames: Math.max(1, to - from) };
  });
}

/**
 * Global frame an event anchor resolves to; undefined when a word anchor matches no word in
 * `narration` (validation rejects such specs once the script exists).
 */
export function anchorToFrame(
  anchor: EventAnchor,
  beat: BeatTiming,
  narration: string,
  fps: number,
): number | undefined {
  const sec = resolveAnchorSec(anchor, beat, narrationWords(narration));
  return sec === undefined ? undefined : secToFrame(sec, fps);
}

export type FramedEvent = { action: EventAction; targets: string[]; frame: number };

/**
 * A beat's events with their global frames, in frame order. Recomputed from word timings; the
 * `timing.events` cache is never read, so it cannot go stale after an edit.
 */
export function resolveEventFrames(
  scene: BeatScene,
  beat: BeatTiming,
  narration: string,
  fps: number,
): FramedEvent[] {
  return scene.events
    .flatMap((event) => {
      const frame = anchorToFrame(event.at, beat, narration, fps);
      return frame === undefined ? [] : [{ action: event.action, targets: event.targets, frame }];
    })
    .sort((a, b) => a.frame - b.frame);
}
