import { validateRenderableVideoSpec, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec, patternFlowBoardSpec } from '../../fixtures/index.ts';
import { specLayout } from '../layout/spec-layout.ts';
import { PRIMITIVES } from '../primitives/registry.ts';
import { getTheme } from '../theme/index.ts';
import { boardState } from './board-state.ts';
import { pinHostText, primitivePinHost, takesPin } from './pin-hosts.ts';
import { withRegistryChecks } from './validate.ts';

describe('pin hosts (registry data)', () => {
  it('board elements host side pins, a connector only the middle, lines and overlays none', () => {
    const host = (id: string) => primitivePinHost(PRIMITIVES.get(id));
    expect(host('node_card')).toBe('sides');
    expect(host('tag')).toBe('sides');
    expect(host('connector')).toBe('middle');
    expect(host('packet_stream')).toBe('none');
    expect(host('statement_card')).toBe('none');
    expect(host('no_such_primitive')).toBe('none');
    expect(pinHostText('middle')).toBe('pins: middle only');
  });

  it('knows which primitives take a pin (a tag does; a stat card does not)', () => {
    expect(takesPin(PRIMITIVES.get('tag'))).toBe(true);
    expect(takesPin(PRIMITIVES.get('stat_card'))).toBe(false);
    expect(takesPin(PRIMITIVES.get('formula_card'))).toBe(false);
  });
});

/** The pattern board's first beat (an `atomic-lock` instance), plus a card and a tag pinned to `to`. */
function pinnedTo(to: string): RenderableVideoSpec {
  const spec = structuredClone(patternFlowBoardSpec);
  const scene = spec.scenes[0]!;
  scene.elements.push(
    { id: 'gate', primitive: 'node_card', props: { title: 'Gate' } },
    { id: 'note', primitive: 'tag', props: { text: 'Note', pin: { to, side: 'top' } } },
  );
  return spec;
}

describe('a pin to a pattern instance', () => {
  it('is an invalid element ref that names the board elements a pin can use', () => {
    const spec = pinnedTo('atomic-lock');
    const result = withRegistryChecks(validateRenderableVideoSpec(spec), spec);
    const found = result.errors.filter((e) => e.code === 'invalid_element_ref');
    expect(found.map((e) => e.path)).toEqual(['$.scenes[0].elements[1].props.pin.to']);
    expect(found[0]?.message).toBe(
      '"atomic-lock" is a pattern instance: neither it nor the elements inside it can host a ' +
        "pin. Pin to one of this board's own elements (gate), or give it a zone instead.",
    );
  });

  it('gets the same explanation from the layout, not "not on this board"', () => {
    const layout = specLayout(pinnedTo('atomic-lock'), getTheme());
    const chain = layout.beats.get(patternFlowBoardSpec.scenes[0]!.beatId)!.chain;
    const pin = chain.board.warnings.find((w) => w.code === 'pin_unresolved');
    expect(pin?.message).toContain('a pattern instance: neither it nor the elements inside it');
    expect(pin?.message).not.toContain('not on this board');
  });

  it('a pin to a board element passes', () => {
    const spec = pinnedTo('gate');
    const result = withRegistryChecks(validateRenderableVideoSpec(spec), spec);
    expect(result.errors.filter((e) => e.code === 'invalid_element_ref')).toEqual([]);
  });
});

describe('ON SCREEN pin hosts (boardState)', () => {
  it('marks each element with the pins it can host, and an instance with none', () => {
    const state = boardState(goldenRateLimiterSpec, 'fleet-fix');
    const of = (id: string) => state.entries.find((e) => e.id === id)?.pinHost;
    expect(of('api-a')).toBe('sides');
    expect(of('to-a')).toBe('middle');
    const flood = boardState(goldenRateLimiterSpec, 'payoff').entries.find((e) => e.id === 'flood');
    expect(flood).toMatchObject({ kind: 'pattern', pinHost: 'none' });
  });
});
