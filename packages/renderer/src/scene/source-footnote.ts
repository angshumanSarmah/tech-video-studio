import type { RenderableVideoSpec } from '@explainer-studio/shared';
import { clamp01 } from '../primitives/geometry.ts';
import { SOURCE_PREFIX } from '../primitives/stat-card/definition.ts';
import type { Rect, Zone } from '../theme/index.ts';

/**
 * The beat source line ("Source: …"): small, in the bottom-left corner of the board frame (the
 * stage, or the card format's diagram window), clear of the avoid zones (the platform buttons sit
 * bottom-right). The layout reserves its line for the whole `continuesPrevious` chain
 * (`specLayout`), so the board never runs under it. Pure.
 */

/** The footnote fades in this long after the beat starts, over `FADE_SEC`. */
export const FOOTNOTE_DELAY_SEC = 0.3;
export const FADE_SEC = 0.3;

/** The line to draw for a beat, or undefined when its script has no source. */
export function footnoteText(spec: RenderableVideoSpec, beatId: string): string | undefined {
  const source = spec.script.find((s) => s.beatId === beatId)?.source;
  return source ? `${SOURCE_PREFIX}${source}` : undefined;
}

/** 0 until the delay after the beat start, then fading to 1. */
export function footnoteOpacity(nowSec: number, beatStartSec: number): number {
  return clamp01((nowSec - beatStartSec - FOOTNOTE_DELAY_SEC) / FADE_SEC);
}

/**
 * Where the line goes: the bottom `height` px of the stage, from its left edge to the first
 * avoid zone that overlaps that band (less `gap`), else the stage's right edge.
 */
export function footnoteRect(
  stage: Rect,
  avoidZones: readonly Zone[],
  height: number,
  gap: number,
): Rect {
  const y = stage.y + stage.height - height;
  const blocking = avoidZones.filter(
    (z) => z.y < y + height && z.y + z.height > y && z.x > stage.x,
  );
  const right = Math.min(stage.x + stage.width, ...blocking.map((z) => z.x - gap));
  return { x: stage.x, y, width: Math.max(0, right - stage.x), height };
}
