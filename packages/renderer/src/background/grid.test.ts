import { describe, expect, it } from 'vitest';
import { getTheme } from '../theme/index.ts';
import { gridCss, gridOffset } from './grid.ts';

const theme = getTheme('blueprint-dark');
const majorCell = theme.grid.minorCell * theme.grid.majorEvery;

describe('grid', () => {
  it('starts at zero and drifts at the theme rate', () => {
    expect(gridOffset(theme, 0)).toEqual({ x: 0, y: 0 });
    const { y } = gridOffset(theme, 1);
    expect(y).toBeCloseTo((theme.grid.drift.y + majorCell) % majorCell);
  });

  it('wraps to one major cell so the pattern loops seamlessly', () => {
    const period = majorCell / Math.abs(theme.grid.drift.y);
    const { x, y } = gridOffset(theme, period * 7);
    expect(x).toBe(0);
    expect(y).toBeCloseTo(0);
    for (const s of [0.5, 3, 100, 1234.5]) {
      const o = gridOffset(theme, s);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThan(majorCell);
    }
  });

  it('emits four gradient layers sized to major and minor cells', () => {
    const css = gridCss(theme, 0);
    expect(css.backgroundImage.match(/linear-gradient/g)).toHaveLength(4);
    expect(css.backgroundSize).toBe(
      `${majorCell}px ${majorCell}px, ${majorCell}px ${majorCell}px, ` +
        `${theme.grid.minorCell}px ${theme.grid.minorCell}px, ${theme.grid.minorCell}px ${theme.grid.minorCell}px`,
    );
  });
});
