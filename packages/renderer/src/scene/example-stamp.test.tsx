import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec, withFormat } from '../../fixtures/index.ts';
import { textWidth } from '../fonts/measure-text.ts';
import { formatAreas } from '../layout/format.ts';
import { overlaps } from '../layout/rect.ts';
import { specLayout } from '../layout/spec-layout.ts';
import { getTheme, listThemes } from '../theme/index.ts';
import { ExampleStamp } from './ExampleStamp.tsx';
import {
  beatShowsExampleStamp,
  EXAMPLE_STAMP_STYLE,
  EXAMPLE_STAMP_TEXT,
  exampleStampBand,
  exampleStampSize,
} from './example-stamp.ts';

// The golden rate limiter's `bucket` beat has example numbers ("a hundred tokens").
const EXAMPLE_BEAT = 'bucket';

describe('the EXAMPLE stamp', () => {
  it('shows only on beats whose plan marks example numbers', () => {
    const shown = goldenRateLimiterSpec.story.beats
      .map((b) => b.id)
      .filter((id) => beatShowsExampleStamp(goldenRateLimiterSpec, id));
    expect(shown).toEqual([EXAMPLE_BEAT]);
  });

  it.each(listThemes().flatMap((t) => (['full', 'card'] as const).map((f) => [t.id, f] as const)))(
    '%s, %s: reserves a band above the board, clear of the avoid zones and every element',
    (themeId, format) => {
      const theme = getTheme(themeId);
      const spec = withFormat(goldenRateLimiterSpec, format);
      const layout = specLayout(spec, theme);
      const chain = layout.beats.get(EXAMPLE_BEAT)!.chain;
      const stamp = chain.stamp!;
      expect(stamp).toBeTruthy();
      // Above the board frame (the board layer is clipped `space.sm` around it).
      expect(stamp.y + stamp.height + theme.space.sm).toBeLessThanOrEqual(
        chain.board.frame.y + 1e-6,
      );
      for (const item of chain.board.items) expect(overlaps(item.rect, stamp)).toBe(false);
      for (const zone of layout.areas.avoidZones) expect(overlaps(zone, stamp)).toBe(false);
      const board = formatAreas(theme, format).board;
      expect(stamp.x).toBeGreaterThanOrEqual(board.x);
      expect(stamp.x + stamp.width).toBeLessThanOrEqual(board.x + board.width + 1e-6);
      // Chains without example numbers reserve nothing.
      expect(layout.beats.get('hook')!.chain.stamp).toBeNull();
    },
  );

  it.each(listThemes().map((t) => [t.id]))('%s: is small, and its text fits its box', (id) => {
    const theme = getTheme(id);
    const size = exampleStampSize(theme);
    const text = textWidth(theme, EXAMPLE_STAMP_STYLE, EXAMPLE_STAMP_TEXT);
    expect(size.width).toBeGreaterThan(text);
    expect(size.width).toBeLessThan(theme.canvas.width / 4);
    expect(size.height).toBeLessThan(80);
  });

  it('moves left of an avoid zone that reaches into the band', () => {
    const theme = getTheme();
    const frame = { x: 0, y: 100, width: 1000, height: 800 };
    const zone = { id: 'actions', x: 900, y: 80, width: 100, height: 60 };
    const { stamp } = exampleStampBand(theme, frame, [zone]);
    expect(stamp.x + stamp.width).toBeLessThanOrEqual(zone.x - theme.space.md);
  });

  it.each(listThemes().map((t) => [t.id, t.hud.style]))(
    '%s draws it in its own style (%s)',
    (id, style) => {
      const theme = getTheme(id);
      const html = renderToStaticMarkup(
        <ExampleStamp theme={theme} rect={{ x: 10, y: 20, width: 120, height: 36 }} opacity={1} />,
      );
      expect(html).toContain(`>${EXAMPLE_STAMP_TEXT}</div>`);
      expect(html).toMatch(style === 'title-block' ? /border-radius:0/ : /border-radius:18px/);
      expect(
        renderToStaticMarkup(
          <ExampleStamp theme={theme} rect={{ x: 0, y: 0, width: 1, height: 1 }} opacity={0} />,
        ),
      ).toBe('');
    },
  );
});
