import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { rateLimiterSpec } from '../../fixtures/index.ts';
import { TYPE_SAMPLES } from '../stills/swatch-parts.tsx';
import { getTheme } from './registry.ts';
import { safeAreas } from './safe-area.ts';
import type { TextStyleName, Theme } from './schema.ts';

/**
 * drafting-paper's display sizes are blueprint-dark's scaled by the ratio of their display
 * advances, so a line holds the same text in both. Checked with real glyph widths from the
 * bundled font files (not the size-hint approximation).
 */

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
const dark = getTheme('blueprint-dark');
const paper = getTheme('drafting-paper');
const DISPLAY: TextStyleName[] = ['headline', 'title', 'chapter', 'metric'];

const fonts = new Map<string, fontkit.Font>();

function fontFor(theme: Theme, style: TextStyleName): fontkit.Font {
  const { font: role, weight } = theme.text[style];
  const files = theme.fonts[role].files;
  const file = files.reduce((best, f) =>
    Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best,
  );
  const cached = fonts.get(file.path);
  if (cached) return cached;
  const font = fontkit.openSync(publicDir + file.path);
  if (!('layout' in font)) throw new Error(`${file.path} is a font collection`);
  fonts.set(file.path, font);
  return font;
}

/** Rendered width in px of `text` in a text style (case transform and letter spacing included). */
function textWidth(theme: Theme, style: TextStyleName, text: string, size?: number): number {
  const s = theme.text[style];
  const shown = s.uppercase ? text.toUpperCase() : text;
  const px = size ?? s.size;
  const font = fontFor(theme, style);
  const advance = (font.layout(shown).advanceWidth / font.unitsPerEm) * px;
  return advance + s.letterSpacing * px * [...shown].length;
}

/** Lines a greedy word wrap needs to fit `text` into `width`. */
function lineCount(theme: Theme, style: TextStyleName, text: string, width: number): number {
  let lines = 1;
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(theme, style, next) > width) {
      lines += 1;
      line = word;
    } else {
      line = next;
    }
  }
  return lines;
}

describe('drafting-paper display sizes', () => {
  it("scale blueprint-dark's by the display advance ratio, to whole px", () => {
    const scale = dark.fonts.display.advanceEm / paper.fonts.display.advanceEm;
    for (const name of DISPLAY) {
      expect(paper.text[name].size, name).toBe(Math.round(dark.text[name].size * scale));
      expect(paper.text[name].lineHeight, name).toBe(dark.text[name].lineHeight);
      expect(paper.text[name].letterSpacing, name).toBe(dark.text[name].letterSpacing);
    }
  });

  it('wrap every rate-limiter headline to the same number of lines in both themes', () => {
    const headlines = rateLimiterSpec.script.flatMap((b) => (b.headline ? [b.headline.text] : []));
    expect(headlines.length).toBeGreaterThan(0);
    for (const text of headlines) {
      const lines = (theme: Theme) =>
        lineCount(theme, 'headline', text, safeAreas(theme).headlineBand.width);
      expect(lines(paper), text).toBe(lines(dark));
    }
  });

  it("fit the swatch board's sample headline on one line in both themes", () => {
    for (const theme of [dark, paper]) {
      const style = theme.text.headline;
      const caption = `headline · ${style.font} ${style.size}/${style.weight}`;
      const captionWidth = textWidth(theme, 'label', caption, 16);
      const width = theme.canvas.width - 2 * theme.space.xl - theme.space.md - captionWidth;
      expect(lineCount(theme, 'headline', TYPE_SAMPLES.headline, width), theme.id).toBe(1);
    }
  });
});
