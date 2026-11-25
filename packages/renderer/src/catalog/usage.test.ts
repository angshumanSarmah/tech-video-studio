import { describe, expect, it } from 'vitest';
import { goldenFixtures, goldenRateLimiterSpec } from '../../fixtures/index.ts';
import { usageOfSpec } from './usage.ts';

const values = (spec: Parameters<typeof usageOfSpec>[0], kind: string) =>
  usageOfSpec(spec)
    .filter((r) => r.kind === kind)
    .map((r) => r.value);

describe('usageOfSpec', () => {
  it('records what the golden rate limiter draws and tells, its hook and main patterns', () => {
    const spec = goldenRateLimiterSpec;
    expect(values(spec, 'hook')).toEqual(['problem/failure_before_fix']);
    expect(values(spec, 'ending')).toEqual(['spec_card_ending']);
    expect(values(spec, 'pattern')).toEqual(['flood_then_funnel', 'versus_split']);
    // In board order, not sorted.
    expect(values(spec, 'pattern_sequence')).toEqual(['versus_split>flood_then_funnel']);
    expect(values(spec, 'layout')).toEqual(['centered_focus', 'pipeline', 'versus_split']);
    expect(values(spec, 'topic_class')).toEqual(['concept']);
  });

  it('gives each value once, sorted by kind then value', () => {
    for (const { spec } of goldenFixtures) {
      const rows = usageOfSpec(spec).map((r) => `${r.kind}:${r.value}`);
      expect(new Set(rows).size).toBe(rows.length);
      expect([...rows].sort()).toEqual(rows);
    }
  });

  it('leaves out what a video does not have: one pattern is no sequence, no device no hook', () => {
    const [, strawberry] = goldenFixtures;
    expect(values(strawberry!.spec, 'pattern_sequence')).toEqual([]);
    expect(values(strawberry!.spec, 'hook')).toEqual([]);
    expect(values(strawberry!.spec, 'ending')).toEqual(['callback_ending']);
  });

  it("takes a continuing board's layout from the beat that started it", () => {
    const spec = structuredClone(goldenRateLimiterSpec);
    const continuing = spec.scenes.find((s) => s.continuesPrevious);
    expect(continuing).toBeDefined();
    continuing!.layoutMode = 'hub_spoke';
    expect(values(spec, 'layout')).not.toContain('hub_spoke');
  });
});
