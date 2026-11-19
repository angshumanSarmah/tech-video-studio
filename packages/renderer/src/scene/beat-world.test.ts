import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { DEFAULT_REGISTRIES, type Registries } from '../catalog/registries.ts';
import { fixtureSpec } from '../catalog/test-specs.ts';
import { buildPatternRegistry } from '../patterns/registry.ts';
import { bouncePattern } from '../patterns/test-pattern.ts';
import { elementState } from '../primitives/element-state.ts';
import patternDecisionBoardJson from '../../fixtures/pattern-decision-board.json';
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
    Object.assign(input.scenes[3]?.patterns?.[0] ?? {}, { pattern: 'flood_and_funnel' });
    const items = world(parseRenderableSpec(input), 'hook');
    expect(items.map((i) => [i.key, i.kind])).toEqual([
      ['client', 'error'],
      ['api', 'primitive'],
      ['rps', 'primitive'],
    ]);
    expect(items[0]).toMatchObject({ title: 'Unknown primitive', detail: 'node_box · client' });
    const payoff = world(parseRenderableSpec(input), 'payoff');
    expect(payoff.map((i) => [i.key, i.kind])).toEqual([
      ['guard', 'primitive'],
      ['flood', 'error'],
    ]);
    expect(payoff[1]).toMatchObject({
      title: 'Unknown pattern',
      detail: 'flood_and_funnel · flood',
    });
  });

  it('draws invalid props as an error item', () => {
    const input = fixtureSpec();
    Object.assign(input.scenes[0]?.elements?.[2] ?? {}, { props: { value: 'lots' } });
    const items = world(parseRenderableSpec(input), 'hook');
    expect(items[2]).toMatchObject({
      kind: 'error',
      title: 'Invalid props',
      detail: 'counter · rps',
    });
  });

  it('gives each primitive parsed props and only the events that target it, in global frames', () => {
    const spec = parseRenderableSpec(fixtureSpec());
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
    const spec = parseRenderableSpec(fixtureSpec());
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
    const input = fixtureSpec();
    Object.assign(input.scenes[0] ?? {}, {
      patterns: [
        {
          id: 'bounce',
          pattern: 'test_bounce',
          params: { label: 'seat h3', at: { bounce: { type: 'word_text', text: 'falls' } } },
        },
      ],
    });
    input.scenes[0]?.events?.push({
      at: { type: 'word', index: 0 },
      action: 'dim',
      targets: ['bounce'],
    });
    input.scenes[0]?.events?.push({
      at: { type: 'word_text', text: 'error' },
      action: 'pulse',
      targets: ['bounce/held'],
    });
    const registries = { ...DEFAULT_REGISTRIES, patterns: buildPatternRegistry([bouncePattern]) };
    const items = world(parseRenderableSpec(input), 'hook', registries);
    const parts = items.filter((i) => i.key.startsWith('bounce/'));
    expect(parts.map((p) => p.key)).toEqual(['bounce/held', 'bounce/second']);
    const actions = parts.map((p) => (p.kind === 'primitive' ? p.events.map((e) => e.action) : []));
    expect(actions).toEqual([
      ['dim', 'pulse'],
      ['dim', 'enter', 'reject'],
    ]);
    expect(parts.map((p) => p.kind === 'primitive' && p.zone)).toEqual(['left', 'right']);
  });

  it('points element refs inside an expansion at their namespaced siblings', () => {
    const items = world(parseRenderableSpec(fixtureSpec()), 'payoff');
    const props = (key: string) => {
      const item = items.find((i) => i.key === key);
      return item?.kind === 'primitive' ? item.props : undefined;
    };
    expect(props('flood/direct')).toMatchObject({ from: 'flood/source', to: 'flood/target' });
    expect(props('flood/flood')).toMatchObject({ along: 'flood/direct' });
    expect(items.find((i) => i.key === 'flood/target')).toMatchObject({ zone: 'sink' });
  });

  it('lets spec events reach one inner element as <instance>/<id>', () => {
    const items = world(parseRenderableSpec(fixtureSpec()), 'payoff');
    const target = items.find((i) => i.key === 'flood/target');
    const source = items.find((i) => i.key === 'flood/source');
    const actions = (item: typeof target) =>
      item?.kind === 'primitive' ? item.events.map((e) => e.action) : [];
    expect(actions(target)).toEqual(['enter', 'reject', 'recover', 'highlight']);
    expect(actions(source)).toEqual(['enter']);
  });
});

describe('contained elements', () => {
  function withInset() {
    const input = fixtureSpec();
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
  const spec = parseRenderableSpec(fixtureSpec());
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
    const { scenes } = parseRenderableSpec(fixtureSpec());
    expect(sceneChain(scenes, 'bucket-intro').map((s) => s.beatId)).toEqual([
      'hook',
      'bucket-intro',
    ]);
    expect(sceneChain(scenes, 'bucket-empty').map((s) => s.beatId)).toEqual(['bucket-empty']);
    expect(sceneChain(scenes, 'missing')).toEqual([]);
  });
});

describe('beatWorld: event engine', () => {
  type Json = Record<string, unknown>;
  const word = (text: string) => ({ type: 'word_text', text });
  const ev = (action: string, targets: string[], text: string, params?: Json) => ({
    at: word(text),
    action,
    targets,
    ...(params ? { params } : {}),
  });
  /** The rate-limiter hook beat with extra elements, events and focus. */
  const hook = (elements: Json[], events: Json[], focus?: string[]) => {
    const input = fixtureSpec();
    const scene = input.scenes[0] as Json & { elements: Json[]; events: Json[] };
    scene.elements.push(...elements);
    scene.events.push(...(events as never[]));
    if (focus) scene.focus = focus;
    return parseRenderableSpec(input);
  };
  const timing = (spec: RenderableVideoSpec) => effectiveTiming(spec).beats[0];
  /** Global frame of the n-th word (0-based) of the hook beat. */
  const wordFrame = (spec: RenderableVideoSpec, index: number) =>
    Math.round((timing(spec)?.words[index]?.startSec ?? 0) * FPS);
  const stateOf = (spec: RenderableVideoSpec, key: string, frame: number) => {
    const item = world(spec, 'hook').find((i) => i.key === key);
    if (item?.kind !== 'primitive') throw new Error(key);
    return elementState(item.events, frame, FPS, item.focus);
  };

  it('dims what is out of the beat’s focus, and the elements pinned to the focus stay lit', () => {
    const pinned = { id: 'note', primitive: 'tag', props: { text: '429', pin: { to: 'api' } } };
    const spec = hook([pinned], [], ['api']);
    const late = wordFrame(spec, 12);
    expect(stateOf(spec, 'api', late).dimmed).toBe(0);
    expect(stateOf(spec, 'note', late).dimmed).toBe(0);
    expect(stateOf(spec, 'client', late).dimmed).toBe(1);
  });

  it('moves the focus at a focus event, animating the change', () => {
    const spec = hook([], [ev('focus', ['client'], 'error')], ['api']);
    const at = wordFrame(spec, 19);
    expect(stateOf(spec, 'api', at - 1).dimmed).toBe(0);
    expect(stateOf(spec, 'api', at + 3).dimmed).toBeGreaterThan(0);
    expect(stateOf(spec, 'api', at + 3).dimmed).toBeLessThan(1);
    expect(stateOf(spec, 'api', at + 20).dimmed).toBe(1);
    expect(stateOf(spec, 'client', at + 20).dimmed).toBe(0);
  });

  it('moves focus to an overlay while it shows: the board dims, the overlay does not', () => {
    const card = {
      id: 'ask',
      primitive: 'statement_card',
      props: { lines: [{ id: 'q', text: 'Why does it fall over?' }] },
    };
    const spec = hook([card], [ev('enter', ['ask'], 'slows'), ev('exit', ['ask'], 'error')]);
    const shown = wordFrame(spec, 14);
    expect(stateOf(spec, 'api', wordFrame(spec, 2)).dimmed).toBe(0);
    expect(stateOf(spec, 'api', shown).dimmed).toBe(1);
    expect(stateOf(spec, 'ask', shown).dimmed).toBe(0);
    expect(stateOf(spec, 'api', wordFrame(spec, 25)).dimmed).toBe(0);
  });

  it('leads a highlight before its word and clears it before the overlay takes focus', () => {
    const card = {
      id: 'ask',
      primitive: 'statement_card',
      props: { lines: [{ id: 'q', text: 'Why does it fall over?' }] },
    };
    const spec = hook(
      [card],
      [ev('highlight', ['client'], 'client'), ev('enter', ['ask'], 'every')],
    );
    const lead = wordFrame(spec, 1) - 3;
    expect(stateOf(spec, 'client', lead).highlight).toBeGreaterThan(0);
    const overlay = wordFrame(spec, 15);
    expect(stateOf(spec, 'client', overlay).highlight).toBe(0);
    const held = hook(
      [card],
      [ev('highlight', ['client'], 'client', { hold: true }), ev('enter', ['ask'], 'every')],
    );
    expect(stateOf(held, 'client', overlay).highlight).toBe(1);
  });

  it('keeps a highlighted board element dimmed behind an overlay; lifts an out-of-focus one', () => {
    const card = {
      id: 'ask',
      primitive: 'statement_card',
      props: { lines: [{ id: 'q', text: 'Why does it fall over?' }] },
    };
    const behind = hook(
      [card],
      [ev('enter', ['ask'], 'slows'), ev('highlight', ['client'], 'falls')],
    );
    const later = wordFrame(behind, 15);
    expect(stateOf(behind, 'client', later)).toMatchObject({ highlight: 1, dimmed: 1 });
    const unfocused = hook([], [ev('highlight', ['client'], 'falls')], ['api']);
    expect(stateOf(unfocused, 'client', wordFrame(unfocused, 8)).dimmed).toBe(1);
    expect(stateOf(unfocused, 'client', later)).toMatchObject({ highlight: 1, dimmed: 0 });
  });

  it('sweeps the brute-force scan one item at a time', () => {
    const spec = parseRenderableSpec(patternDecisionBoardJson);
    const items = beatWorld(
      spec,
      effectiveTiming(spec),
      'brute-force-then-index',
      FPS,
      DEFAULT_REGISTRIES,
    ).find((i) => i.key === 'brute-force-then-index/items');
    if (items?.kind !== 'primitive') throw new Error('items');
    const scan = items.events.filter((e) => e.action === 'reject' || e.action === 'pulse');
    const secs = scan.map((e) => e.sec);
    expect(new Set(secs).size).toBe(secs.length);
    expect(secs.at(-1)! - secs[0]!).toBeGreaterThan(0.4);
  });
});
