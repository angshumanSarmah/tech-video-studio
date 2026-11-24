import type { RenderableVideoSpec } from '@explainer-studio/shared';
import { textWidth } from '../fonts/measure-text.ts';
import { lineHeightPx } from '../primitives/measure.ts';
import type { Size } from '../primitives/types.ts';
import type { Rect, TextStyleName, Theme, Zone } from '../theme/index.ts';

/**
 * The EXAMPLE stamp: a small label drawn by code on a beat whose numbers are illustrative
 * (`story.beats[].exampleNumbers`), so no label on the board needs marking of its own. It sits
 * right-aligned in a band the layout reserves at the top of the board frame for every chain
 * with such a beat (`specLayout`), clear of the avoid zones, so it never covers the board's
 * content; the board is fitted below the band. Pure.
 */

export const EXAMPLE_STAMP_TEXT = 'EXAMPLE';
export const EXAMPLE_STAMP_STYLE: TextStyleName = 'hud';

/** Whether the beat shows the stamp: the plan marks its numbers as an example. */
export function beatShowsExampleStamp(spec: RenderableVideoSpec, beatId: string): boolean {
  return spec.story.beats.find((b) => b.id === beatId)?.exampleNumbers === true;
}

/** Whether any beat of a chain shows it (the chain then reserves the band). */
export function chainHasExampleStamp(spec: RenderableVideoSpec, beatIds: readonly string[]) {
  return beatIds.some((id) => beatShowsExampleStamp(spec, id));
}

/** The stamp's box: its text in the stamp style, padded, inside a thin border. */
export function exampleStampSize(theme: Theme): Size {
  const { space, stroke } = theme;
  const text = textWidth(theme, EXAMPLE_STAMP_STYLE, EXAMPLE_STAMP_TEXT);
  return {
    width: Math.ceil(text + 2 * (space.sm + stroke.thin)),
    height: lineHeightPx(theme, EXAMPLE_STAMP_STYLE) + 2 * (space.xs + stroke.thin),
  };
}

/**
 * The band at the top of `frame` and the stamp in it: right-aligned, left of any avoid zone
 * that reaches into the band (less `space.md`).
 */
export function exampleStampBand(
  theme: Theme,
  frame: Rect,
  avoidZones: readonly Zone[],
): { band: Rect; stamp: Rect } {
  const size = exampleStampSize(theme);
  const band = { x: frame.x, y: frame.y, width: frame.width, height: size.height };
  const blocking = avoidZones.filter(
    (z) => z.y < band.y + band.height && z.y + z.height > band.y && z.x > frame.x,
  );
  const right = Math.min(frame.x + frame.width, ...blocking.map((z) => z.x - theme.space.md));
  const x = Math.max(frame.x, right - size.width);
  return { band, stamp: { x, y: band.y, width: size.width, height: size.height } };
}
