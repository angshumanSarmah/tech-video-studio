import { effectiveTiming } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { parseRenderableSpec } from '../compositions/metadata.ts';
import { ACTION_DURATION_SEC } from '../events/presets.ts';
import { beatSettledOffsets } from './settled.ts';
import { fixtureSpec, withHoldAfter } from './test-specs.ts';

type Json = Record<string, unknown>;

describe('beatSettledOffsets', () => {
  const spec = parseRenderableSpec(fixtureSpec());
  const offsets = beatSettledOffsets(spec);

  it('gives every beat with events the time from its start until they have played out', () => {
    expect([...offsets.keys()]).toEqual(['hook', 'bucket-intro', 'bucket-empty', 'payoff']);
    for (const beat of effectiveTiming(spec).beats) {
      expect(offsets.get(beat.beatId)).toBeGreaterThan(0);
    }
  });

  it('does not depend on where the beat sits on the track', () => {
    const held = parseRenderableSpec(withHoldAfter(fixtureSpec(), 'hook', 2));
    const shifted = beatSettledOffsets(held);
    for (const [beatId, offset] of offsets) expect(shifted.get(beatId)).toBeCloseTo(offset, 6);
  });

  it('counts a late enter until its draw has finished, past the narration', () => {
    const input = fixtureSpec();
    const scene = input.scenes[2] as Json & { elements: Json[]; events: Json[] };
    scene.elements.push({ id: 'note', primitive: 'node_card', props: { title: 'Late' } });
    const atEnd = { type: 'beat', edge: 'end', offsetSec: 0 };
    scene.events.push({ at: atEnd, action: 'enter', targets: ['note'] });
    const late = parseRenderableSpec(input);
    const beat = effectiveTiming(late).beats.find((b) => b.beatId === 'bucket-empty');
    const narrationSec = (beat?.endSec ?? 0) - (beat?.startSec ?? 0);
    const offset = beatSettledOffsets(late).get('bucket-empty') ?? 0;
    expect(offset).toBeGreaterThanOrEqual(narrationSec + ACTION_DURATION_SEC.enter - 1e-6);
  });

  it('ignores events anchored in an earlier beat of the chain', () => {
    // bucket-intro continues hook; hook's own events must not set bucket-intro's offset.
    const input = fixtureSpec();
    (input.scenes[1] as Json & { events: Json[] }).events = [];
    expect(beatSettledOffsets(parseRenderableSpec(input)).has('bucket-intro')).toBe(false);
  });
});
