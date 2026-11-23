import {
  headlineAnchor,
  resolveHud,
  type EffectiveTiming,
  type HeadlineSemantic,
  type HudPart,
  type RenderableVideoSpec,
  type StoryClock,
} from '@explainer-studio/shared';
import type { SafeAreas } from '../theme/index.ts';
import { anchorToFrame, type BeatFrameSpan } from '../timing/frames.ts';

/** Pure HUD state: what each part shows at a frame. Components only animate it. */

/** Something on the HUD timeline that starts at `from` (inclusive) and ends at `to` (exclusive). */
export type FrameSpan = { from: number; to: number };

/**
 * Which HUD parts to draw: on in `spec.hud` (with `auto` resolved from the story devices, see
 * `resolveHud`) and with data to show.
 */
export function visibleHudParts(spec: RenderableVideoSpec): Record<HudPart, boolean> {
  const { story, script } = spec;
  const hud = resolveHud(spec.hud, story.devices);
  return {
    topBar: hud.topBar,
    chapterHeader: hud.chapterHeader,
    stepTracker: hud.stepTracker,
    heroMetric: hud.heroMetric && story.heroMetric !== undefined,
    storyClock: hud.storyClock && story.heroMetric?.storyClock !== undefined,
    headline: hud.headline && script.some((beat) => beat.headline !== undefined),
  };
}

/** True when the beat shows a headline, so its chain's board gets `stageWithHeadline`. */
export function beatHasHeadline(spec: RenderableVideoSpec, beatId: string): boolean {
  if (!spec.hud.headline) return false;
  return spec.script.some((beat) => beat.beatId === beatId && beat.headline !== undefined);
}

/** The stage a beat's board may use: smaller when the beat shows a headline. */
export function stageForBeat(areas: SafeAreas, spec: RenderableVideoSpec, beatId: string) {
  return beatHasHeadline(spec, beatId) ? areas.stageWithHeadline : areas.stage;
}

/** The latest item that has started by `frame`. */
export function activeAt<T extends { from: number }>(items: readonly T[], frame: number) {
  return items.findLast((item) => item.from <= frame);
}

export type ChapterSpan = FrameSpan & {
  chapterId: string;
  /** 0-based position among the chapters. */
  index: number;
  title: string;
  /** What the chapter header shows: the question form when there is one. */
  heading: string;
};

/** One span per chapter, from its first beat's start to its last beat's end. */
export function chapterSpans(
  spec: RenderableVideoSpec,
  spans: readonly BeatFrameSpan[],
): ChapterSpan[] {
  const chapterOf = new Map(spec.story.beats.map((b) => [b.id, b.chapterId]));
  return spec.story.chapters.flatMap((chapter, index) => {
    const mine = spans.filter((s) => chapterOf.get(s.beatId) === chapter.id);
    const first = mine[0];
    const last = mine.at(-1);
    if (!first || !last) return [];
    return [
      {
        chapterId: chapter.id,
        index,
        title: chapter.title,
        heading: chapter.question ?? chapter.title,
        from: first.from,
        to: last.from + last.durationInFrames,
      },
    ];
  });
}

export type HeadlineCue = FrameSpan & {
  beatId: string;
  text: string;
  semantic: HeadlineSemantic;
};

/** A cue per beat with a headline: from its anchor to the end of the beat's span. */
export function headlineCues(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  spans: readonly BeatFrameSpan[],
  fps: number,
): HeadlineCue[] {
  return spans.flatMap((span) => {
    const script = spec.script.find((s) => s.beatId === span.beatId);
    const beat = timing.beats.find((b) => b.beatId === span.beatId);
    if (!script?.headline || !beat) return [];
    const from = anchorToFrame(headlineAnchor(script.headline), beat, script.narration, fps);
    if (from === undefined) return [];
    const { text, semantic } = script.headline;
    return [{ beatId: span.beatId, text, semantic, from, to: span.from + span.durationInFrames }];
  });
}

/** Cues ended by `until` (a frame) at the latest; a cue starting there or later is dropped. */
export function cuesUntil(cues: readonly HeadlineCue[], until: number | undefined): HeadlineCue[] {
  if (until === undefined) return [...cues];
  return cues.filter((c) => c.from < until).map((c) => ({ ...c, to: Math.min(c.to, until) }));
}

export type ClockPoint = { sec: number; value: number };

/**
 * The clock's keyframes on the narration track: `startValue` at the first beat's start, each
 * keyframe at its beat's start, `endValue` at the last beat's end.
 */
export function storyClockPoints(clock: StoryClock, timing: EffectiveTiming): ClockPoint[] {
  const first = timing.beats[0];
  const last = timing.beats.at(-1);
  if (!first || !last) return [];
  const keyframes = clock.keyframes.flatMap((k) => {
    const beat = timing.beats.find((b) => b.beatId === k.beatId);
    return beat ? [{ sec: beat.startSec, value: k.value }] : [];
  });
  return [
    { sec: first.startSec, value: clock.startValue },
    ...keyframes,
    { sec: last.endSec, value: clock.endValue },
  ];
}

/** Clock value at `sec`: linear between points, held before the first and after the last. */
export function clockValueAt(points: readonly ClockPoint[], sec: number): number {
  const next = points.findIndex((p) => p.sec > sec);
  if (next === -1) return points.at(-1)?.value ?? 0;
  const b = points[next];
  const a = points[next - 1];
  if (!b || !a) return b?.value ?? 0;
  const t = b.sec === a.sec ? 1 : (sec - a.sec) / (b.sec - a.sec);
  return a.value + (b.value - a.value) * t;
}

/** Whole story seconds as m:ss, or h:mm:ss from an hour. */
export function formatClock(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
