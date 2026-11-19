import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { FONT_SOURCES } from '../../scripts/font-sources.ts';
import {
  bundledFont,
  bundledFonts,
  FONT_ROLES,
  listThemes,
  type BundledFontKey,
  type FontRole,
  type Theme,
} from '../theme/index.ts';
import { describeCodePoint, REQUIRED_CODE_POINTS } from './glyphs.ts';

/**
 * Reads the character map of every bundled font file. A required glyph missing from a role's
 * whole bundled stack would render in a system font. Fix by adding the glyph to a source font or
 * a bundled fallback, then `pnpm --filter @explainer-studio/renderer fonts:subset`.
 */

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

function characterSet(path: string): Set<number> {
  const font = fontkit.openSync(publicDir + path);
  if (!('characterSet' in font)) throw new Error(`${path} is a font collection`);
  return new Set(font.characterSet);
}

/** Code points every file of a face has: the browser may pick any of its weights. */
function faceCoverage(theme: Theme, key: BundledFontKey): Set<number> {
  const sets = (bundledFont(theme, key)?.files ?? []).map((f) => characterSet(f.path));
  return new Set([...(sets[0] ?? [])].filter((cp) => sets.every((s) => s.has(cp))));
}

function stackCoverage(theme: Theme, role: FontRole): Set<number> {
  const keys = [role, ...theme.fonts[role].bundledFallbacks];
  return new Set(keys.flatMap((k) => [...faceCoverage(theme, k)]));
}

describe.each(listThemes().map((t) => [t.id, t] as const))('fonts of %s', (_id, theme) => {
  it.each(FONT_ROLES)('the %s stack covers every required glyph', (role) => {
    const covered = stackCoverage(theme, role);
    const missing = REQUIRED_CODE_POINTS.filter((cp) => !covered.has(cp)).map(describeCodePoint);
    expect(missing, `missing from ${stackFamilies(theme, role)}`).toEqual([]);
  });

  it('builds every font file from a pinned source', () => {
    const themed = bundledFonts(theme).flatMap((face) => face.files.map((f) => f.path));
    const sourced = FONT_SOURCES.map((s) => s.out);
    expect(themed.filter((p) => !sourced.includes(p))).toEqual([]);
  });
});

it('has no font source that no theme uses', () => {
  const used = new Set(
    listThemes().flatMap((t) => bundledFonts(t).flatMap((face) => face.files.map((f) => f.path))),
  );
  expect(FONT_SOURCES.map((s) => s.out).filter((p) => !used.has(p))).toEqual([]);
});

function stackFamilies(theme: Theme, role: FontRole): string {
  return [role, ...theme.fonts[role].bundledFallbacks]
    .map((k) => bundledFont(theme, k)?.family ?? k)
    .join(' + ');
}
