import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { fixtureSpec } from '../catalog/test-specs.ts';
import { getTheme, safeAreas } from '../theme/index.ts';
import {
  FADE_SEC,
  FOOTNOTE_DELAY_SEC,
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
