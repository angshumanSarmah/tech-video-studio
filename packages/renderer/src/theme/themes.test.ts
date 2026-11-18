import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './colour.ts';
import { listThemes } from './registry.ts';
import { FONT_ROLES, SEMANTIC_COLOURS } from './schema.ts';

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

describe.each(listThemes().map((t) => [t.id, t] as const))('theme %s', (_id, theme) => {
  const bg = theme.colours.background;

  it('bundles every font file it references', () => {
    for (const role of FONT_ROLES) {
      for (const file of theme.fonts[role].files) {
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
});
