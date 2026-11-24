import type { RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenRateLimiterSpec, goldenStrawberrySpec } from '../../fixtures/index.ts';
import { colourWarnings } from './colour-checks.ts';

type Scene = RenderableVideoSpec['scenes'][number];

/** The golden rate limiter's `fleet` beat (scene 4): its focus is the `leak` counter. */
const FLEET = 4;

function golden(change: (fleet: Scene) => void): RenderableVideoSpec {
  const spec = structuredClone(goldenRateLimiterSpec);
  const fleet = spec.scenes[FLEET];
  if (!fleet) throw new Error('no fleet scene');
  change(fleet);
  return spec;
}

function props(scene: Scene, id: string): Record<string, unknown> {
  const element = scene.elements.find((e) => e.id === id);
  if (!element) throw new Error(`no element ${id}`);
  return element.props;
}

const codes = (spec: RenderableVideoSpec) => colourWarnings(spec).map((w) => `${w.path} ${w.code}`);

describe('colourWarnings', () => {
  it('passes the golden rate limiter', () => {
    expect(codes(goldenRateLimiterSpec)).toEqual([]);
  });

  it("finds the strawberry's takeaway tag drawn in focus beside its focused counter", () => {
    // Advisory, kept: the golden images would need a refresh (docs/TODO.md).
    expect(codes(goldenStrawberrySpec)).toEqual(['$.scenes[3].elements[2] focus_colour_off_focus']);
  });

  it('flags an element in the focus colour that is never the focus', () => {
    const spec = golden((fleet) => (props(fleet, 'user').semantic = 'focus'));
    expect(codes(spec)).toEqual([`$.scenes[${FLEET}].elements[0] focus_colour_off_focus`]);
    expect(colourWarnings(spec)[0]?.message).toContain('(its focus is leak)');
  });

  it('accepts one a focus event moves to, and one pinned to the focus', () => {
    const moved = golden((fleet) => {
      props(fleet, 'user').semantic = 'focus';
      fleet.events.push({
        at: { type: 'word_text', text: 'user', occurrence: 1 },
        action: 'focus',
        targets: ['user'],
        params: {},
      });
    });
    expect(codes(moved)).toEqual([]);
    const pinned = golden((fleet) => {
      fleet.focus = ['api-a'];
      props(fleet, 'count-a').semantic = 'focus';
    });
    expect(codes(pinned)).toEqual([]);
  });

  it('reports a host once, not what is pinned to it', () => {
    const spec = golden((fleet) => {
      props(fleet, 'api-a').semantic = 'focus';
      props(fleet, 'count-a').semantic = 'focus';
    });
    expect(codes(spec)).toEqual([`$.scenes[${FLEET}].elements[1] focus_colour_off_focus`]);
  });

  it('flags a reject on an element drawn ok, whole elements only', () => {
    const spec = golden((fleet) => (props(fleet, 'leak').semantic = 'ok'));
    const rejectAt = spec.scenes[FLEET]?.events.findIndex((e) => e.action === 'reject');
    expect(codes(spec)).toEqual([`$.scenes[${FLEET}].events[${rejectAt}] ok_element_rejected`]);
  });
});
