import type { Rect } from '../theme/index.ts';

/** Absolute CSS placement for a canvas rect (`Rect` uses x/y, which CSS ignores). */
export function rectCss(r: Rect) {
  return { position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height } as const;
}
