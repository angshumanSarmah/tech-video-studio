import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { rateLimiterSpec, transitionsBoardSpec } from '../../fixtures/index.ts';
import { beatRenderInputs, chainOf } from './render-inputs.ts';

/** Stable JSON of the inputs, as the worker hashes them. */
const key = (spec: RenderableVideoSpec, beatId: string) =>
  JSON.stringify(beatRenderInputs(spec, beatId));

/** A copy of `spec` with one scene changed. */
function editScene(
  spec: RenderableVideoSpec,
  beatId: string,
  edit: (scene: RenderableVideoSpec['scenes'][number]) => RenderableVideoSpec['scenes'][number],
): RenderableVideoSpec {
  return { ...spec, scenes: spec.scenes.map((s) => (s.beatId === beatId ? edit(s) : s)) };
}

const withFocus = (spec: RenderableVideoSpec, beatId: string) =>
  editScene(spec, beatId, (s) => ({ ...s, focus: [...s.focus, 'edited-focus'] }));

describe('chainOf', () => {
  it('returns the whole continuesPrevious chain, from either end', () => {
    // rate-limiter: bucket-intro continues hook.
    expect(chainOf(rateLimiterSpec.scenes, 'hook')).toEqual(['hook', 'bucket-intro']);
    expect(chainOf(rateLimiterSpec.scenes, 'bucket-intro')).toEqual(['hook', 'bucket-intro']);
    expect(chainOf(rateLimiterSpec.scenes, 'payoff')).toEqual(['payoff']);
    expect(chainOf(rateLimiterSpec.scenes, 'nope')).toEqual([]);
  });
});

describe('beatRenderInputs', () => {
  it('is unchanged when a scene outside the chain changes', () => {
    const edited = withFocus(rateLimiterSpec, 'payoff');
    expect(key(edited, 'bucket-empty')).toBe(key(rateLimiterSpec, 'bucket-empty'));
    expect(key(edited, 'hook')).toBe(key(rateLimiterSpec, 'hook'));
  });

  it('changes for the edited beat and every beat in its chain', () => {
    const edited = withFocus(rateLimiterSpec, 'bucket-intro');
    expect(key(edited, 'bucket-intro')).not.toBe(key(rateLimiterSpec, 'bucket-intro'));
    // A later beat in the chain moves the shared placement of the earlier one.
    expect(key(edited, 'hook')).not.toBe(key(rateLimiterSpec, 'hook'));
  });

  it('changes for every beat when a global field changes', () => {
    const hud = { ...rateLimiterSpec.hud, topBar: !rateLimiterSpec.hud.topBar };
    const edited = { ...rateLimiterSpec, hud };
    for (const beat of ['hook', 'bucket-empty', 'payoff']) {
      expect(key(edited, beat)).not.toBe(key(rateLimiterSpec, beat));
    }
  });

  it('changes when an earlier beat shifts this beat in time (estimated timing)', () => {
    const script = rateLimiterSpec.script.map((s) =>
      s.beatId === 'hook' ? { ...s, narration: `${s.narration} Five more words right here.` } : s,
    );
    const edited = { ...rateLimiterSpec, script };
    expect(key(edited, 'payoff')).not.toBe(key(rateLimiterSpec, 'payoff'));
  });

  it("includes the next scene's semantic zoom (it pushes this beat's camera)", () => {
    // transitions board: hash-table zooms in from cache-front's redis-server.
    const edited = editScene(transitionsBoardSpec, 'hash-table', (s) => ({
      ...s,
      transitionIn: 'fade',
      zoomFrom: undefined,
    }));
    expect(key(edited, 'cache-front')).not.toBe(key(transitionsBoardSpec, 'cache-front'));
    expect(beatRenderInputs(transitionsBoardSpec, 'cache-front').next).toEqual({
      transitionIn: 'zoom-in',
      zoomFrom: 'redis-server',
    });
  });

  it('ignores the timing.events cache', () => {
    const { beats } = effectiveTiming(rateLimiterSpec);
    const timed = (events: { beatId: string; eventIndex: number; atSec: number }[]) => ({
      ...rateLimiterSpec,
      timing: { audioFile: 'runs/1/narration.wav', beats, events },
    });
    expect(key(timed([{ beatId: 'payoff', eventIndex: 0, atSec: 9 }]), 'hook')).toBe(
      key(timed([]), 'hook'),
    );
  });
});
