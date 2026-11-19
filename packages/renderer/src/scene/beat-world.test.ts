import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { DEFAULT_REGISTRIES, type Registries } from '../catalog/registries.ts';
import { fixtureSpec, registryValidSpec } from '../catalog/test-specs.ts';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { elementState } from '../primitives/element-state.ts';
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
    const input = fixtureSpec();
    Object.assign(input.scenes[0]?.elements?.[0] ?? {}, { primitive: 'node_box' });
    const items = world(parseRenderableSpec(input), 'hook');
    expect(items.map((i) => [i.key, i.kind])).toEqual([
      ['client', 'error'],
      ['api', 'primitive'],
      ['rps', 'primitive'],
      ['flood', 'error'],
    ]);
    expect(items[0]).toMatchObject({ title: 'Unknown primitive', detail: 'node_box · client' });
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
    const registries = { ...DEFAULT_REGISTRIES, patterns: buildPatternRegistry([bouncePattern]) };
    const items = world(parseRenderableSpec(input), 'hook', registries);
    const parts = items.filter((i) => i.key.startsWith('bounce/'));
    expect(parts.map((p) => p.key)).toEqual(['bounce/held', 'bounce/second']);
    const actions = parts.map((p) => (p.kind === 'primitive' ? p.events.map((e) => e.action) : []));
    expect(actions).toEqual([['enter'], ['enter', 'enter', 'reject']]);
  });
});

describe('contained elements', () => {
  function withInset() {
    const input = registryValidSpec();
    input.scenes[0]?.elements?.push(
      { id: 'note', primitive: 'tag', props: { text: '429' } },
      { id: 'zoom', primitive: 'inset_panel', props: { anchor: 'api', children: ['rps', 'note'] } },
    );
    return parseRenderableSpec(input);
  }

  it('nests children under their container instead of the board, in board order', () => {
    const items = world(withInset(), 'hook');
    expect(items.map((i) => i.key)).toEqual(['client', 'api', 'zoom']);
    const zoom = items.find((i) => i.key === 'zoom');
    expect(zoom).toMatchObject({ kind: 'primitive', layer: 'overlay' });
    expect(zoom?.kind === 'primitive' && zoom.children.map((c) => c.key)).toEqual(['rps', 'note']);
  });

  it('keeps children with their own events, through continuesPrevious', () => {
    const items = world(withInset(), 'bucket-intro');
    const zoom = items.find((i) => i.key === 'zoom');
    const rps = zoom?.kind === 'primitive' ? zoom.children.find((c) => c.key === 'rps') : undefined;
    expect(rps?.kind === 'primitive' && rps.events.map((e) => e.action)).toEqual([
      'enter',
      'pulse',
    ]);
  });
});

describe('elapsed time across beats', () => {
  const spec = parseRenderableSpec(registryValidSpec());
  const timing = effectiveTiming(spec);
  const nextStart = timing.beats.find((b) => b.beatId === 'bucket-intro')?.startSec ?? 0;
  // One second into the next beat, on a frame boundary at both the draft and final rates.
  const nowSec = Math.ceil(nextStart * 15) / 15 + 1;

  function rpsState(fps: number) {
    const items = beatWorld(spec, timing, 'bucket-intro', fps, DEFAULT_REGISTRIES);
    const rps = items.find((i) => i.key === 'rps');
    if (rps?.kind !== 'primitive') throw new Error('rps is not a primitive');
    const enter = rps.events.find((e) => e.action === 'enter');
    return { enterSec: enter?.sec ?? NaN, state: elementState(rps.events, nowSec * fps, fps) };
  }

  it('measures an action that started in the previous beat from its own time, not the beat cut', () => {
    const { enterSec, state } = rpsState(30);
    expect(enterSec).toBeLessThan(nextStart);
    expect(state.elapsed.enter).toBeCloseTo(nowSec - enterSec, 6);
    expect(state.elapsed.enter).toBeGreaterThan(nowSec - nextStart);
  });

  it('gives the same elapsed time at the draft and final frame rates', () => {
    expect(rpsState(15).state.elapsed.enter).toBeCloseTo(
      rpsState(30).state.elapsed.enter ?? NaN,
      9,
    );
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
