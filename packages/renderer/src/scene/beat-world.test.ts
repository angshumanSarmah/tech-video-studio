import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { DEFAULT_REGISTRIES, type Registries } from '../catalog/registries.ts';
import { fixtureSpec, registryValidSpec } from '../catalog/test-specs.ts';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { PRIMITIVES } from '../primitives/registry.ts';
import { beatWorld, sceneChain } from './beat-world.ts';

const FPS = 30;

function world(
  spec: RenderableVideoSpec,
  beatId: string,
  registries: Registries = DEFAULT_REGISTRIES,
) {
  return beatWorld(spec, effectiveTiming(spec), beatId, FPS, registries);
}

describe('beatWorld', () => {
  it('draws unknown primitives and patterns as error items, never as content', () => {
    const items = world(parseRenderableSpec(fixtureSpec()), 'hook');
    expect(items.map((i) => [i.key, i.kind])).toEqual([
      ['client', 'error'],
      ['api', 'error'],
      ['rps', 'primitive'],
      ['flood', 'error'],
    ]);
    expect(items[0]).toMatchObject({ title: 'Unknown primitive', detail: 'node_card · client' });
    expect(items[3]).toMatchObject({
      title: 'Unknown pattern',
      detail: 'flood_then_funnel · flood',
    });
  });

  it('draws invalid props as an error item', () => {
    const input = registryValidSpec();
    Object.assign(input.scenes[0]?.elements?.[2] ?? {}, { props: { value: 'lots' } });
    const items = world(parseRenderableSpec(input), 'hook');
    expect(items[2]).toMatchObject({
      kind: 'error',
      title: 'Invalid props',
      detail: 'counter · rps',
    });
  });

  it('gives each primitive parsed props and only the events that target it, in global frames', () => {
    const spec = parseRenderableSpec(registryValidSpec());
    const rps = world(spec, 'hook').find((i) => i.key === 'rps');
    expect(rps).toMatchObject({
      kind: 'primitive',
      props: { value: 10000, semantic: 'focus', decimals: 0 },
    });
    expect(rps?.kind === 'primitive' && rps.events.map((e) => e.action)).toEqual([
      'enter',
      'pulse',
    ]);
  });

  it('carries inherited elements and their earlier events through continuesPrevious', () => {
    const spec = parseRenderableSpec(registryValidSpec());
    const items = world(spec, 'bucket-intro');
    expect(items.map((i) => i.key)).toEqual(['client', 'api', 'rps', 'bucket']);
    const api = items.find((i) => i.key === 'api');
    expect(api?.kind === 'primitive' && api.events.map((e) => e.action)).toEqual([
      'enter',
      'reject',
      'dim',
    ]);
    const timing = effectiveTiming(spec);
    const introStart = Math.round((timing.beats[1]?.startSec ?? 0) * FPS);
    expect(api?.kind === 'primitive' && api.events[2]?.frame).toBeGreaterThan(introStart);
  });

  it('expands a registered pattern into namespaced parts; instance events reach every part', () => {
    const input = registryValidSpec();
    input.scenes[0]?.patterns?.push({
      id: 'bounce',
      pattern: 'test_bounce',
      params: { label: 'seat h3', at: { bounce: { type: 'word_text', text: 'falls' } } },
    });
    input.scenes[0]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'enter',
      targets: ['bounce'],
    });
    const registries = { primitives: PRIMITIVES, patterns: buildPatternRegistry([bouncePattern]) };
    const items = world(parseRenderableSpec(input), 'hook', registries);
    const parts = items.filter((i) => i.key.startsWith('bounce/'));
    expect(parts.map((p) => p.key)).toEqual(['bounce/held', 'bounce/second']);
    const actions = parts.map((p) => (p.kind === 'primitive' ? p.events.map((e) => e.action) : []));
    expect(actions).toEqual([['enter'], ['enter', 'enter', 'reject']]);
  });
});

describe('sceneChain', () => {
  it('walks back through continuesPrevious', () => {
    const { scenes } = parseRenderableSpec(registryValidSpec());
    expect(sceneChain(scenes, 'bucket-intro').map((s) => s.beatId)).toEqual([
      'hook',
      'bucket-intro',
    ]);
    expect(sceneChain(scenes, 'bucket-empty').map((s) => s.beatId)).toEqual(['bucket-empty']);
    expect(sceneChain(scenes, 'missing')).toEqual([]);
  });
});
