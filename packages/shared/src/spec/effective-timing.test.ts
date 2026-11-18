import { describe, expect, it } from 'vitest';
import {
  END_TAIL_SEC,
  ESTIMATED_BEAT_GAP_SEC,
  ESTIMATED_WORDS_PER_SEC,
  effectiveTiming,
  estimateBeatTimings,
} from './effective-timing.ts';
import type { RenderableVideoSpec } from './shape.ts';
import { validSpec } from './test-fixtures.ts';
import { validateRenderableVideoSpec } from './validate.ts';

function renderable(withTiming: boolean): RenderableVideoSpec {
  const input = validSpec();
  if (!withTiming) delete input.timing;
  const result = validateRenderableVideoSpec(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

describe('estimateBeatTimings', () => {
  const beats = estimateBeatTimings(renderable(false).script);

  it('times each beat from its word count, with a gap between beats', () => {
    const [hook, intro] = beats;
    expect(hook?.startSec).toBe(0);
    expect(hook?.endSec).toBeCloseTo(10 / ESTIMATED_WORDS_PER_SEC);
    expect(intro?.startSec).toBeCloseTo(10 / ESTIMATED_WORDS_PER_SEC + ESTIMATED_BEAT_GAP_SEC);
    expect(intro?.endSec).toBeCloseTo((intro?.startSec ?? 0) + 7 / ESTIMATED_WORDS_PER_SEC);
  });

  it('gives one evenly spaced timed word per narration word', () => {
    const hook = beats[0];
    expect(hook?.words.map((w) => w.text).slice(0, 3)).toEqual(['one', 'client', 'sends']);
    expect(hook?.words).toHaveLength(10);
    expect(hook?.words[1]?.startSec).toBeCloseTo(1 / ESTIMATED_WORDS_PER_SEC);
    expect(hook?.words.at(-1)?.endSec).toBeCloseTo(hook?.endSec ?? 0);
  });

  it('keeps a beat without words at least one word long', () => {
    const [beat] = estimateBeatTimings([
      { beatId: 'b', narration: '— …', tags: [], statCards: [] },
    ]);
    expect(beat?.endSec).toBeCloseTo(1 / ESTIMATED_WORDS_PER_SEC);
    expect(beat?.words).toEqual([]);
  });
});

describe('effectiveTiming', () => {
  it('uses the timing layer when present', () => {
    const timing = effectiveTiming(renderable(true));
    expect(timing.estimated).toBe(false);
    expect(timing.beats.map((b) => b.startSec)).toEqual([0, 4.15, 7.15]);
    expect(timing.endSec).toBe(10 + END_TAIL_SEC);
  });

  it('estimates when the timing layer is missing', () => {
    const timing = effectiveTiming(renderable(false));
    expect(timing.estimated).toBe(true);
    expect(timing.beats.map((b) => b.beatId)).toEqual(['hook', 'bucket-intro', 'bucket-empty']);
    expect(timing.endSec).toBeCloseTo((timing.beats.at(-1)?.endSec ?? 0) + END_TAIL_SEC);
  });
});
