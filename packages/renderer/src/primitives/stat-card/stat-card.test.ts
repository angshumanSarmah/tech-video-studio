import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec } from '../../../fixtures/index.ts';
import { DEFAULT_REGISTRIES } from '../../catalog/registries.ts';
import { beatWorld } from '../../scene/beat-world.ts';
import { getTheme } from '../../theme/index.ts';
import { statCardPrimitive, statCardSizeHints, type StatCardProps } from './definition.ts';

const card: StatCardProps = {
  value: '10k/s',
  label: 'peak requests',
  source: '<example-publisher> post-incident report',
  semantic: 'focus',
};

describe('stat_card beside the beat footnote', () => {
  const hide = (props: StatCardProps, footnote: string) => {
    if (!statCardPrimitive.besideFootnote) throw new Error('stat_card hides a repeated source');
    return statCardPrimitive.besideFootnote(props, footnote);
  };

  it('drops its own source line when the footnote already says it', () => {
    expect(hide(card, card.source).source).toBe('');
    expect(hide(card, `  ${card.source} `).source).toBe('');
  });

  it('keeps it when the footnote names another source', () => {
    expect(hide(card, '<example-other-source>')).toBe(card);
  });

  it('is shorter without its source line', () => {
    const theme = getTheme();
    const full = statCardSizeHints(card, theme).preferredHeight;
    const bare = statCardSizeHints({ ...card, source: '' }, theme).preferredHeight;
    expect(bare).toBeLessThan(full);
  });

  it('is drawn without it on a beat whose source line matches (the scene layer applies it)', () => {
    const spec: RenderableVideoSpec = structuredClone(goldenRateLimiterSpec);
    const [script] = spec.script;
    const [scene] = spec.scenes;
    if (!script || !scene) throw new Error('no hook');
    script.source = card.source;
    scene.elements.push({ id: 'peak', primitive: 'stat_card', props: { ...card } });
    const world = beatWorld(spec, effectiveTiming(spec), scene.beatId, 30, DEFAULT_REGISTRIES);
    const peak = world.find((item) => item.key === 'peak');
    expect(peak?.kind === 'primitive' ? (peak.props as StatCardProps).source : undefined).toBe('');
  });

  it('hides it only on beats whose footnote matches, and is sized for the beats that show it', () => {
    const spec: RenderableVideoSpec = structuredClone(goldenRateLimiterSpec);
    const fleet = spec.scenes.findIndex((s) => s.beatId === 'fleet');
    const [adds, later] = [spec.script[fleet], spec.script[fleet + 1]];
    const scene = spec.scenes[fleet];
    if (!adds || !later || !scene || !spec.scenes[fleet + 1]?.continuesPrevious) {
      throw new Error('fleet is continued by the next beat');
    }
    adds.source = card.source;
    later.source = '<example-other-source>';
    scene.elements.push({ id: 'peak', primitive: 'stat_card', props: { ...card } });
    const timing = effectiveTiming(spec);
    const sourceOn = (beatId: string, mode?: 'chain') => {
      const world = beatWorld(spec, timing, beatId, 30, DEFAULT_REGISTRIES, undefined, mode);
      const peak = world.find((item) => item.key === 'peak');
      return peak?.kind === 'primitive' ? (peak.props as StatCardProps).source : undefined;
    };
    expect(sourceOn(adds.beatId)).toBe('');
    expect(sourceOn(later.beatId)).toBe(card.source);
    expect(sourceOn(later.beatId, 'chain')).toBe(card.source);
    later.source = card.source;
    expect(sourceOn(later.beatId, 'chain')).toBe('');
  });
});
