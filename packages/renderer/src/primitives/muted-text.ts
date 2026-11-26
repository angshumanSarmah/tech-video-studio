import { DIMMED_MUTED_MIN_CONTRAST, dimOpacity } from '../events/presets.ts';
import { blendOver, contrastRatio } from '../theme/colour.ts';
import type { Theme } from '../theme/index.ts';

/**
 * The colour of muted text (`ink.muted`) inside an element dimmed by `dimmed` (pure). Dimming is
 * one opacity on the whole element, so text inside cannot be dimmed less than its box; instead
 * the muted ink moves toward the primary ink just far enough that, drawn at the element's
 * opacity over the background, it keeps `DIMMED_MUTED_MIN_CONTRAST`. Undimmed (or where the
 * muted ink already passes) it is `ink.muted` unchanged, so settled, in-focus frames are as
 * before. Memoised per theme and dim level.
 */
export function mutedText(theme: Theme, dimmed: number): string {
  const { muted, primary } = theme.colours.ink;
  if (dimmed <= 0) return muted;
  const key = `${theme.id}|${dimmed.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const colour = solve(theme, dimmed, muted, primary);
  cache.set(key, colour);
  return colour;
}

const cache = new Map<string, string>();

/** The least shift toward `primary` (binary search on the mix) that meets the floor. */
function solve(theme: Theme, dimmed: number, muted: string, primary: string): string {
  const bg = theme.colours.background;
  const opacity = dimOpacity(dimmed);
  const passes = (c: string) =>
    contrastRatio(blendOver(c, opacity, bg), bg) >= DIMMED_MUTED_MIN_CONTRAST;
  const mix = (t: number) => blendOver(primary, t, muted);
  if (passes(muted)) return muted;
  if (!passes(primary)) return primary;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    if (passes(mix(mid))) hi = mid;
    else lo = mid;
  }
  return mix(hi);
}

const themes = new Map<string, Theme>();

/**
 * The theme a dimmed element is drawn with: the same theme, its `ink.muted` replaced by
 * `mutedText` (memoised). `WorldItemView` passes it to every primitive, so muted text keeps its
 * floor in any component without one of its own. Unchanged (the same object) while the muted ink
 * already passes.
 */
export function dimmedTheme(theme: Theme, dimmed: number): Theme {
  const muted = mutedText(theme, dimmed);
  if (muted === theme.colours.ink.muted) return theme;
  const key = `${theme.id}|${muted}`;
  const hit = themes.get(key);
  if (hit) return hit;
  const next: Theme = {
    ...theme,
    colours: { ...theme.colours, ink: { ...theme.colours.ink, muted } },
  };
  themes.set(key, next);
  return next;
}
