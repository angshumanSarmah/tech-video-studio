import { effectiveTiming, validateRenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { fixtureChannelHandle, goldenFixtures, withFormat } from '../../fixtures/index.ts';
import { hudTextWarnings } from '../hud/hud-text-checks.ts';
import { specLayoutWarnings } from '../layout/spec-layout.ts';
import { subtitleWarnings } from '../subtitles/subtitle-checks.ts';
import { getTheme } from '../theme/index.ts';
import { withRegistryChecks } from './validate.ts';

/**
 * The golden fixtures are written to the standard agent output is held to: warnings count as
 * failures there, so a golden fixture has none, and its boards lay out cleanly in its format.
 */
describe.each(goldenFixtures.map((f) => [f.spec.meta.id, f] as const))('%s', (_id, fixture) => {
  it('is valid with no registry errors or warnings', () => {
    const result = withRegistryChecks(validateRenderableVideoSpec(fixture.json), fixture.json);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('lays out without layout warnings in the default theme', () => {
    expect(specLayoutWarnings(fixture.spec, getTheme())).toEqual([]);
  });

  it('cuts no HUD text off in the default theme', () => {
    const context = { seriesLabel: fixture.series.label, channelHandle: fixtureChannelHandle };
    expect(hudTextWarnings(fixture.spec, getTheme(), context)).toEqual([]);
  });

  it('fits every subtitle word on a line in both formats', () => {
    for (const format of ['full', 'card'] as const) {
      expect(subtitleWarnings(withFormat(fixture.spec, format), getTheme())).toEqual([]);
    }
  });

  it('has estimated timing only (no audio) and is a valid Short length', () => {
    expect(fixture.spec.timing).toBeUndefined();
    const { endSec } = effectiveTiming(fixture.spec);
    expect(endSec).toBeGreaterThanOrEqual(45);
    expect(endSec).toBeLessThanOrEqual(90);
  });
});
