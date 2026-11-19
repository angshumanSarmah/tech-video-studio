import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blendOver, contrastRatio } from './colour.ts';
import { listThemes } from './registry.ts';
import { SEMANTIC_COLOURS } from './schema.ts';
import { bundledFonts } from './text.ts';

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

describe.each(listThemes().map((t) => [t.id, t] as const))('theme %s', (_id, theme) => {
  const bg = theme.colours.background;

  it('bundles every font file it references', () => {
    for (const face of bundledFonts(theme)) {
      for (const file of face.files) {
        expect(existsSync(publicDir + file.path), file.path).toBe(true);
      }
    }
  });

  it('keeps text readable on the background', () => {
    expect(contrastRatio(theme.colours.ink.primary, bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.colours.ink.muted, bg)).toBeGreaterThanOrEqual(
      theme.minimumContrast.text,
    );
    expect(contrastRatio(theme.colours.fallbackAccent, bg)).toBeGreaterThanOrEqual(
      theme.minimumContrast.text,
    );
    for (const name of SEMANTIC_COLOURS) {
      const ratio = contrastRatio(theme.colours.semantic[name], bg);
      expect(ratio, name).toBeGreaterThanOrEqual(theme.minimumContrast.text);
    }
  });

  it('keeps ink readable on every semantic fill override', () => {
    for (const name of SEMANTIC_COLOURS) {
      const fill = theme.tint.fills[name];
      if (!fill) continue;
      for (const under of [bg, theme.colours.surface]) {
        const filled = blendOver(fill.colour, fill.alpha, under);
        const ratio = contrastRatio(theme.colours.semantic[name], filled);
        expect(ratio, `${name} on its fill over ${under}`).toBeGreaterThanOrEqual(
          theme.minimumContrast.text,
        );
      }
    }
  });
});
