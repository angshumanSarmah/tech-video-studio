import { validateVideoSpec, type BeatScene, type VideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import type { FixtureTopicId } from '../fixture-topics.ts';
import { placeholderScene } from './board.ts';
import {
  beatAncestors,
  beatDependency,
  beatDependents,
  createWarmUp,
  visibleScenes,
} from './schedule.ts';
import { fixtureScriptedSpec } from './testing.ts';

function specOf(topic: FixtureTopicId): VideoSpec {
  const spec = validateVideoSpec(fixtureScriptedSpec(topic)).spec;
  if (!spec) throw new Error(`the ${topic} fixture spec is invalid`);
  return spec;
}

const rateLimiter = specOf('rate-limiter');
const tokenizer = specOf('tokenizer');
const dependencies = (spec: VideoSpec) => spec.story.beats.map((_, i) => beatDependency(spec, i));

describe('the Generator run order', () => {
  it('chains a continuing beat after its board, and starts every other beat on its own', () => {
    // rate limiter: [1] [2] [3→4] [5] [6] [7] [8]
    expect(dependencies(rateLimiter)).toEqual([
      undefined,
      undefined,
      undefined,
      2,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('runs a semantic-zoom beat after the board it zooms from', () => {
    // tokenizer: [b1] [b2→b3→b4] [b5] [b6] [b7]; b3 zooms from b2, b4 continues b3
    expect(dependencies(tokenizer)).toEqual([
      undefined,
      undefined,
      1,
      2,
      undefined,
      undefined,
      undefined,
    ]);
    expect(beatAncestors(tokenizer, 3)).toEqual([1, 2]);
    expect(beatDependents(tokenizer, 1)).toEqual([2, 3]);
    expect(beatDependents(tokenizer, 2)).toEqual([3]);
    expect(beatDependents(rateLimiter, 4)).toEqual([]);
  });

  it('shows a beat only the boards it depends on', () => {
    const scenes: BeatScene[] = tokenizer.story.beats.map(placeholderScene);
    const visible = visibleScenes(tokenizer, 3, scenes);
    expect(visible.map((s) => s !== undefined)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('createWarmUp', () => {
  it('lets the first call finish before any other starts, even when it fails', async () => {
    const order: string[] = [];
    const warmUp = createWarmUp();
    let release: () => void = () => undefined;
    const first = warmUp(
      () =>
        new Promise<never>((_, reject) => {
          order.push('first start');
          release = () => {
            order.push('first end');
            reject(new Error('cold call failed'));
          };
        }),
    );
    const second = warmUp(() => {
      order.push('second start');
      return Promise.resolve(2);
    });
    await Promise.resolve();
    expect(order).toEqual(['first start']);
    release();
    await expect(first).rejects.toThrow('cold call failed');
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first start', 'first end', 'second start']);
  });
});
