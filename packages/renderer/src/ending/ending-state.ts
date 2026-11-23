import {
  sentenceStartIndexes,
  type EffectiveTiming,
  type RenderableVideoSpec,
} from '@explainer-studio/shared';
import { DRAW_MAX_SEC } from '../events/presets.ts';
import { secToFrame } from '../timing/frames.ts';

/**
 * The ending card's content and timing, from `story.ending` (spec card lines, series number,
 * call to action). Drawn by code, like the headline and the source footnote; the agents never
 * place it. Pure.
 */

/** Without word timings, the card enters this long before the final beat's narration ends. */
export const ENDING_FALLBACK_SEC = 2.5;

/** The card's frame and rules draw on over this long (`draw` enter style themes). */
export const ENDING_DRAW_SEC = DRAW_MAX_SEC;

/** What the card shows. */
export type EndingContent = {
  /** The header cell: the series label, with "#<n>" when the spec has a series number. */
  header: string;
  /** The spec card's lines (none for an ending with only a call to action). */
  lines: readonly string[];
  cta: string | undefined;
};

/** True when the ending has something to show (spec card lines or a CTA). */
export function hasEndingCard(spec: RenderableVideoSpec): boolean {
  const { ending } = spec.story;
  return (ending.specCard?.lines.length ?? 0) > 0 || Boolean(ending.cta);
}

/** The card's content, or undefined when the ending has neither spec card lines nor a CTA. */
export function endingContent(
  spec: RenderableVideoSpec,
  seriesLabel: string,
): EndingContent | undefined {
  if (!hasEndingCard(spec)) return undefined;
  const { ending } = spec.story;
  const lines = ending.specCard?.lines ?? [];
  return { header: endingHeader(seriesLabel, ending.seriesNumber), lines, cta: ending.cta };
}

/** "System Design #12", or the label alone without a series number. */
export function endingHeader(seriesLabel: string, seriesNumber: number | undefined): string {
  return seriesNumber === undefined ? seriesLabel : `${seriesLabel} #${seriesNumber}`;
}

/**
 * When the card enters (seconds on the narration track): the first word of the final beat's last
 * sentence, or `ENDING_FALLBACK_SEC` before the beat's narration ends when it has no word
 * timings (never before the beat starts). Undefined for a spec without beats.
 */
export function endingStartSec(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
): number | undefined {
  const beat = timing.beats.at(-1);
  if (!beat) return undefined;
  const narration = spec.script.find((s) => s.beatId === beat.beatId)?.narration ?? '';
  const start = sentenceStartIndexes(narration).at(-1);
  const word = start === undefined ? undefined : beat.words[start];
  if (word) return word.startSec;
  return Math.max(beat.startSec, beat.endSec - ENDING_FALLBACK_SEC);
}

/** The card on the timeline: what it shows and the frame it enters at; it holds to the end. */
export type EndingCue = { content: EndingContent; from: number };

export function endingCue(
  spec: RenderableVideoSpec,
  timing: EffectiveTiming,
  fps: number,
  seriesLabel: string,
): EndingCue | undefined {
  const content = endingContent(spec, seriesLabel);
  const sec = endingStartSec(spec, timing);
  if (!content || sec === undefined) return undefined;
  return { content, from: secToFrame(sec, fps) };
}
