import { SOURCE_MAX_LENGTH, VIDEO_FORMATS } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { fixtureSpec } from '../catalog/test-specs.ts';
import { formatAreas } from '../layout/format.ts';
import { SOURCE_PREFIX } from '../primitives/stat-card/definition.ts';
import { getTheme, listThemes, safeAreas, type Theme } from '../theme/index.ts';
import {
  FADE_SEC,
  FOOTNOTE_DELAY_SEC,
  footnoteLine,
  footnoteOpacity,
  footnoteRect,
  footnoteText,
} from './source-footnote.ts';

describe('footnoteText', () => {
  it('prefixes the beat source, and is absent without one', () => {
    const input = fixtureSpec();
    Object.assign((input.script as object[])[0] ?? {}, { source: '<example-publisher> report' });
    const spec = parseRenderableSpec(input);
    expect(footnoteText(spec, 'hook')).toBe('Source: <example-publisher> report');
    expect(footnoteText(spec, 'payoff')).toBeUndefined();
  });
});

describe('footnoteOpacity', () => {
  it('fades in shortly after the beat starts', () => {
    expect(footnoteOpacity(10, 10)).toBe(0);
    expect(footnoteOpacity(10 + FOOTNOTE_DELAY_SEC + FADE_SEC / 2, 10)).toBeCloseTo(0.5);
    expect(footnoteOpacity(20, 10)).toBe(1);
  });
});

describe('footnoteRect', () => {
  it('sits in the bottom-left of the stage and stops before an avoid zone', () => {
    const areas = safeAreas(getTheme());
    const rect = footnoteRect(areas.stage, areas.avoidZones, 30, 24);
    expect(rect.x).toBe(areas.stage.x);
    expect(rect.y + rect.height).toBe(areas.stage.y + areas.stage.height);
    for (const zone of areas.avoidZones) {
      const overlapsRows = zone.y < rect.y + rect.height && zone.y + zone.height > rect.y;
      if (overlapsRows) expect(rect.x + rect.width).toBeLessThanOrEqual(zone.x);
    }
  });

  it('takes the stage width when no zone is in its row', () => {
    const stage = { x: 0, y: 0, width: 900, height: 1000 };
    expect(footnoteRect(stage, [], 30, 24).width).toBe(900);
  });
});

describe('SOURCE_MAX_LENGTH', () => {
  /** Characters that fit on a footnote line at the footnote style's average advance. */
  function averageChars(theme: Theme, width: number): number {
    const { size, font, letterSpacing } = theme.text.footnote;
    return Math.floor(width / (size * (theme.fonts[font].advanceEm + letterSpacing)));
  }

  it('is what fits after "Source: " on the narrowest footnote line of any theme and format', () => {
    const fits = listThemes().flatMap((theme) =>
      VIDEO_FORMATS.flatMap((format) => {
        const areas = formatAreas(theme, format);
        return [areas.board, areas.boardWithHeadline].map((frame) => {
          const line = footnoteLine(theme, frame, areas.avoidZones);
          return averageChars(theme, line.width) - SOURCE_PREFIX.length;
        });
      }),
    );
    expect(SOURCE_MAX_LENGTH).toBe(Math.min(...fits));
  });
});
