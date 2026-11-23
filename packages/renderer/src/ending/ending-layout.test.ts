import { SPEC_CARD_LINE_MAX, type VideoFormat } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec } from '../../fixtures/index.ts';
import { fitsLine } from '../fonts/measure-text.ts';
import { formatAreas } from '../layout/format.ts';
import { bottom, inside, overlaps } from '../layout/rect.ts';
import { listThemes, safeAreas } from '../theme/index.ts';
import {
  clearOfZones,
  ENDING_CTA_LINES,
  ENDING_STYLES,
  endingBox,
  endingRegion,
  endingRooms,
  rowHeight,
} from './ending-layout.ts';

const FORMATS: VideoFormat[] = ['full', 'card'];
const CASES = listThemes().flatMap((theme) => FORMATS.map((format) => ({ theme, format })));
const name = ({ theme, format }: (typeof CASES)[number]) => `${theme.id} ${format}`;

/** A CTA long enough to take every line the card allows. */
const LONG_CTA = 'Share this with the teammate who still budgets by word count. '.repeat(4).trim();

describe('endingRegion', () => {
  it.each(CASES.map((c) => [name(c), c] as const))(
    '%s: on the board, clear of the platform UI',
    (_, c) => {
      const region = endingRegion(c.theme, c.format);
      const areas = formatAreas(c.theme, c.format);
      const safe = safeAreas(c.theme);
      expect(inside(safe.stage, region)).toBe(true);
      expect(region.y).toBeGreaterThanOrEqual(bottom(safe.hudBand));
      expect(overlaps(region, areas.subtitleBand)).toBe(false);
      for (const zone of safe.exclusionZones) expect(overlaps(region, zone)).toBe(false);
    },
  );
});

describe('endingBox', () => {
  it.each(CASES.map((c) => [name(c), c] as const))(
    '%s: three lines and the longest CTA fit the region',
    (_, c) => {
      const content = { lines: ['a', 'b', 'c'], cta: LONG_CTA };
      const { box, rows, ctaLines } = endingBox(c.theme, c.format, content);
      expect(ctaLines).toBe(ENDING_CTA_LINES);
      expect(inside(endingRegion(c.theme, c.format), box)).toBe(true);
      expect(rows.map((r) => r.kind)).toEqual(['header', 'line', 'line', 'line', 'cta']);
      rows.forEach((row, i) => {
        const before = rows[i - 1];
        expect(row.y).toBe(before ? before.y + before.height : c.theme.stroke.thin);
      });
      const last = rows.at(-1);
      expect(Math.ceil((last?.y ?? 0) + (last?.height ?? 0) + c.theme.stroke.thin)).toBe(
        box.height,
      );
    },
  );

  it('sizes the CTA row by its wrapped lines and leaves rows out without content', () => {
    const [theme] = listThemes();
    if (!theme) throw new Error('no themes');
    const { rows, ctaLines } = endingBox(theme, 'full', { lines: [], cta: 'Follow for more' });
    expect(ctaLines).toBe(1);
    expect(rows.map((r) => r.kind)).toEqual(['header', 'cta']);
    expect(rows[1]?.height).toBe(rowHeight(theme, 'cta', 1));
  });
});

describe('spec card lines', () => {
  it.each(CASES.map((c) => [name(c), c] as const))(
    `%s: a ${SPEC_CARD_LINE_MAX}-character line fits on one line`,
    (_, c) => {
      const line = goldenRateLimiterSpec.story.ending.specCard?.lines.find(
        (l) => l.length === SPEC_CARD_LINE_MAX,
      );
      if (!line) throw new Error(`the golden fixture has a ${SPEC_CARD_LINE_MAX}-character line`);
      expect(fitsLine(c.theme, ENDING_STYLES.line, line, endingRooms(c.theme, c.format).line)).toBe(
        true,
      );
    },
  );
});

describe('clearOfZones', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };

  it('keeps the side of a zone that leaves more height', () => {
    expect(clearOfZones(rect, [{ id: 'z', x: 80, y: 70, width: 20, height: 30 }], 5)).toEqual({
      ...rect,
      height: 65,
    });
    expect(clearOfZones(rect, [{ id: 'z', x: 80, y: 0, width: 20, height: 30 }], 5)).toEqual({
      ...rect,
      y: 35,
      height: 65,
    });
  });

  it('ignores zones it does not overlap', () => {
    expect(clearOfZones(rect, [{ id: 'z', x: 120, y: 0, width: 20, height: 30 }], 5)).toEqual(rect);
  });
});
