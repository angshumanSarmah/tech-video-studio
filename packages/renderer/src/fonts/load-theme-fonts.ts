import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';
import { bundledFonts, type Theme } from '../theme/index.ts';

const loaded = new Set<string>();

/**
 * Loads every bundled font file of a theme once per process. `loadFont` holds the render
 * (`delayRender`) until each face is ready, so text never renders in a fallback font.
 */
export function loadThemeFonts(theme: Theme): void {
  if (loaded.has(theme.id)) return;
  loaded.add(theme.id);
  for (const { family, files } of bundledFonts(theme)) {
    for (const file of files) {
      void loadFont({ family, url: staticFile(file.path), weight: String(file.weight) });
    }
  }
}
