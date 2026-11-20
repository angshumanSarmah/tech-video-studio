import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { approxTextWidth } from '../primitives/measure.ts';
import {
  bundledFonts,
  getTheme,
  listThemes,
  type TextStyleName,
  type Theme,
} from '../theme/index.ts';
import {
  describeRoom,
  roomInChars,
  textWidth,
  wrapText,
  type FontMetricsTable,
} from './measure-text.ts';

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

/** fontkit's own layout of `text` (kerning included), as the browser would draw it. */
function fontkitWidth(theme: Theme, style: TextStyleName, text: string): number {
  const s = theme.text[style];
  const files = theme.fonts[s.font].files;
  const file = files.reduce((best, f) =>
    Math.abs(f.weight - s.weight) < Math.abs(best.weight - s.weight) ? f : best,
  );
  const font = fontkit.openSync(publicDir + file.path);
  if (!('layout' in font)) throw new Error('collection');
  const shown = s.uppercase ? text.toUpperCase() : text;
  const advance = (font.layout(shown).advanceWidth / font.unitsPerEm) * s.size;
  return advance + s.letterSpacing * s.size * [...shown].length;
}

const SAMPLES = [
  'Sennrich, Haddow & Birch, ACL 2016',
  'Example Labs scheduler study, March 2025',
  'WHAT ABOUT MANY SERVERS?',
  'shared counter',
];

describe('textWidth', () => {
  it.each(listThemes().map((t) => t.id))(
    '%s: matches the font files within kerning (at most 3% narrower, never narrower)',
    (id) => {
      const theme = getTheme(id);
      for (const style of ['footnote', 'label', 'data', 'title'] as const) {
        for (const text of SAMPLES) {
          const measured = textWidth(theme, style, text);
          const laidOut = fontkitWidth(theme, style, text);
          expect(measured, `${style}: ${text}`).toBeGreaterThanOrEqual(laidOut - 0.5);
          expect(measured, `${style}: ${text}`).toBeLessThanOrEqual(laidOut * 1.03 + 0.5);
        }
      }
    },
  );

  it('equals the average-advance estimate for a monospace style', () => {
    const theme = getTheme('drafting-paper');
    for (const text of SAMPLES) {
      expect(textWidth(theme, 'data', text)).toBeCloseTo(
        approxTextWidth(theme, 'data', text),
        -0.5,
      );
    }
  });

  it("measures glyphs no bundled face has at the role's average advance", () => {
    const theme = getTheme('drafting-paper');
    const empty: FontMetricsTable = Object.fromEntries(
      bundledFonts(theme).flatMap((face) =>
        face.files.map((f) => [f.path, { unitsPerEm: 1000, ranges: [], advance: 500, widths: {} }]),
      ),
    );
    const { size } = theme.text.footnote;
    expect(textWidth(theme, 'footnote', 'ab', { metrics: empty })).toBeCloseTo(
      2 * theme.fonts.sans.advanceEm * size,
    );
  });
});

describe('roomInChars', () => {
  it('counts about how many everyday characters fit, case transform included', () => {
    const theme = getTheme();
    const text = 'Refill rate per key';
    const room = textWidth(theme, 'hud', text);
    expect(Math.abs(roomInChars(theme, 'hud', room) - text.length)).toBeLessThanOrEqual(3);
    expect(roomInChars(theme, 'hud', 0)).toBe(0);
    // Wider glyphs (display) fit fewer characters in the same room.
    expect(roomInChars(theme, 'title', 600)).toBeLessThan(roomInChars(theme, 'footnote', 600));
  });

  it('states a room in px and characters', () => {
    const theme = getTheme();
    expect(describeRoom(theme, 'hud', 123.4)).toBe(
      `123 px (about ${roomInChars(theme, 'hud', 123.4)} characters)`,
    );
  });
});

describe('wrapText', () => {
  const theme = getTheme('drafting-paper');
  const word = (n: number) => 'x'.repeat(n);

  it('breaks greedily at spaces, like CSS', () => {
    const width = textWidth(theme, 'data', word(10));
    expect(wrapText(theme, 'data', `${word(4)} ${word(5)}`, width)).toEqual({
      lines: 1,
      overflows: false,
    });
    expect(wrapText(theme, 'data', `${word(4)} ${word(5)} ${word(3)}`, width).lines).toBe(2);
    expect(wrapText(theme, 'data', '', width).lines).toBe(0);
  });

  it('flags a word wider than the line', () => {
    const width = textWidth(theme, 'data', word(10));
    expect(wrapText(theme, 'data', `${word(3)} ${word(11)}`, width)).toEqual({
      lines: 2,
      overflows: true,
    });
  });
});
