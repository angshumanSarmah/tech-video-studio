import { withAlpha, type Theme } from '../theme/index.ts';

export type GridCss = {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
};

/** Offset of a drift after `seconds`, wrapped to one major cell so the pattern loops seamlessly. */
export function gridOffset(theme: Theme, seconds: number): { x: number; y: number } {
  const major = theme.grid.minorCell * theme.grid.majorEvery;
  const wrap = (v: number) => ((v % major) + major) % major;
  return { x: wrap(theme.grid.drift.x * seconds), y: wrap(theme.grid.drift.y * seconds) };
}

/** Two-level blueprint grid (minor cells plus a major line every `majorEvery` cells). */
export function gridCss(theme: Theme, seconds: number): GridCss {
  const { minorCell, majorEvery, colour, minorAlpha, majorAlpha } = theme.grid;
  const minor = withAlpha(colour, minorAlpha);
  const major = withAlpha(colour, majorAlpha);
  const majorCell = minorCell * majorEvery;
  const line = (c: string, angle: string) => `linear-gradient(${angle}, ${c} 1px, transparent 1px)`;
  const { x, y } = gridOffset(theme, seconds);
  const pos = `${x}px ${y}px`;
  return {
    backgroundImage: [
      line(major, '0deg'),
      line(major, '90deg'),
      line(minor, '0deg'),
      line(minor, '90deg'),
    ].join(', '),
    backgroundSize: [majorCell, majorCell, minorCell, minorCell]
      .map((s) => `${s}px ${s}px`)
      .join(', '),
    backgroundPosition: [pos, pos, pos, pos].join(', '),
  };
}
