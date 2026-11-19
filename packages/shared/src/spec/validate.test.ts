import { describe, expect, it } from 'vitest';
import type { VideoSpecInput } from './shape.ts';
import { validSpec } from './test-fixtures.ts';
import {
  toJsonPath,
  validateRenderableVideoSpec,
  validateVideoSpec,
  type SpecError,
} from './validate.ts';

/** The valid fixture with `mutate` applied. */
function mutated(mutate: (spec: Required<VideoSpecInput>) => void): VideoSpecInput {
  const spec = validSpec() as Required<VideoSpecInput>;
  mutate(spec);
  return spec;
}

function errorsAfter(mutate: (spec: Required<VideoSpecInput>) => void): SpecError[] {
  return validateVideoSpec(mutated(mutate)).errors;
}

/** The spec with optional layers removed. */
function without(
  spec: VideoSpecInput,
  ...layers: ('script' | 'scenes' | 'timing')[]
): VideoSpecInput {
  for (const layer of layers) delete spec[layer];
  return spec;
}

function clockKeyframes(spec: Required<VideoSpecInput>) {
  const keyframes = spec.story.heroMetric?.storyClock?.keyframes;
  if (!keyframes) throw new Error('fixture has no story clock keyframes');
  return keyframes;
}

const at = <T>(items: T[] | undefined, index: number): T => {
  const item = items?.[index];
  if (item === undefined) throw new Error(`fixture has no item ${index}`);
  return item;
};

describe('validateVideoSpec: valid specs', () => {
  it('accepts the full fixture and applies defaults', () => {
    const result = validateVideoSpec(validSpec());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const [, second, third] = result.spec.scenes ?? [];
    expect(second?.patterns).toEqual([]);
    expect(third?.transitionIn).toBe('cut');
    expect(result.spec.story.beats[1]?.factIds).toEqual([]);
    expect(result.spec.hud).toMatchObject({
      topBar: true,
      chapterHeader: 'auto',
      stepTracker: 'auto',
    });
  });

  it('accepts a beat source line', () => {
    const spec = validSpec();
    Object.assign(at(spec.script ?? [], 0), { source: '<example-publisher> report, 2026-01-01' });
    expect(validateVideoSpec(spec).ok).toBe(true);
  });

  it('defaults meta.format to full, accepts card and rejects other formats', () => {
    const plain = validateVideoSpec(validSpec());
    expect(plain.ok && plain.spec.meta.format).toBe('full');
    const spec = validSpec();
    const card = validateVideoSpec({ ...spec, meta: { ...spec.meta, format: 'card' } });
    expect(card.ok && card.spec.meta.format).toBe('card');
    const odd = validateVideoSpec({ ...spec, meta: { ...spec.meta, format: 'square' } });
    expect(odd.ok).toBe(false);
    expect(odd.errors.map((e) => [e.path, e.code])).toEqual([['$.meta.format', 'invalid_value']]);
  });

  it('keeps HUD toggles that are set and defaults the rest to on', () => {
    const result = validateVideoSpec({ ...validSpec(), hud: { storyClock: false } });
    expect(result.ok && result.spec.hud).toMatchObject({ storyClock: false, headline: true });
  });

  it('accepts a scene without a layout mode (its patterns or the default decide)', () => {
    const errors = errorsAfter((spec) => delete at(spec.scenes, 0).layoutMode);
    expect(errors).toEqual([]);
  });

  it('accepts an event target inside a pattern instance; the renderer checks the inner id', () => {
    const errors = errorsAfter((spec) => (at(at(spec.scenes, 0).events, 0).targets = ['flood/x']));
    expect(errors).toEqual([]);
  });

  it('rejects a target nested deeper than one pattern level', () => {
    const errors = errorsAfter((spec) => (at(at(spec.scenes, 0).events, 0).targets = ['a/b/c']));
    expect(errors).toContainEqual(
      expect.objectContaining({ path: '$.scenes[0].events[0].targets[0]', code: 'invalid_format' }),
    );
  });

  it('accepts a story-only spec (Gate 2)', () => {
    const { schemaVersion, meta, story } = validSpec();
    expect(validateVideoSpec({ schemaVersion, meta, story }).ok).toBe(true);
  });

  it('leaves primitive, pattern and layout ids to the registries', () => {
    const errors = errorsAfter((spec) => {
      at(at(spec.scenes, 0).elements, 0).primitive = 'not_registered_yet';
      at(spec.scenes, 0).layoutMode = 'made_up_layout';
    });
    expect(errors).toEqual([]);
  });
});

describe('validateVideoSpec: structure', () => {
  it.each<[string, (spec: Required<VideoSpecInput>) => void, Partial<SpecError>]>([
    [
      'coordinates on an element',
      (spec) => Object.assign(at(at(spec.scenes, 0).elements, 0), { x: 10, width: 200 }),
      { path: '$.scenes[0].elements[0]', code: 'unrecognized_keys' },
    ],
    [
      'an unsupported schema version',
      (spec) => Object.assign(spec, { schemaVersion: 2 }),
      { path: '$.schemaVersion', code: 'invalid_value' },
    ],
    [
      'an unknown topic class',
      (spec) => Object.assign(spec.meta, { topicClass: 'gossip' }),
      { path: '$.meta.topicClass', code: 'invalid_value' },
    ],
    [
      'a beat source line with a line break',
      (spec) => Object.assign(at(spec.script, 0), { source: 'Line one\nline two' }),
      { path: '$.script[0].source', code: 'invalid_format' },
    ],
    [
      'a world scene (reserved for phase 2)',
      (spec) => Object.assign(at(spec.scenes, 0), { kind: 'world' }),
      { path: '$.scenes[0].kind', code: 'invalid_value' },
    ],
    [
      'a headline without a semantic',
      (spec) => Object.assign(at(spec.script, 0), { headline: { text: 'Cache = near copy' } }),
      { path: '$.script[0].headline.semantic', code: 'invalid_value' },
    ],
    [
      'a non-slug id',
      (spec) => Object.assign(at(spec.story.beats, 0), { id: 'Beat One' }),
      { path: '$.story.beats[0].id', code: 'invalid_format' },
    ],
    [
      'a beat-start anchor with a negative offset',
      (spec) =>
        Object.assign(at(at(spec.scenes, 0).events, 0), {
          at: { type: 'beat', edge: 'start', offsetSec: -1 },
        }),
      { path: '$.scenes[0].events[0].at.offsetSec', code: 'custom' },
    ],
    [
      'an unknown HUD part',
      (spec) => Object.assign(spec, { hud: { ticker: false } }),
      { path: '$.hud', code: 'unrecognized_keys' },
    ],
    [
      'a story clock keyframe with a negative value',
      (spec) =>
        Object.assign(spec.story, {
          heroMetric: {
            label: 'l',
            value: 'v',
            storyClock: {
              from: 'a',
              to: 'b',
              startValue: 0,
              endValue: 1,
              keyframes: [{ beatId: 'bucket-intro', value: -1 }],
            },
          },
        }),
      { path: '$.story.heroMetric.storyClock.keyframes[0].value', code: 'too_small' },
    ],
    [
      'an event with no targets',
      (spec) => Object.assign(at(at(spec.scenes, 0).events, 0), { targets: [] }),
      { path: '$.scenes[0].events[0].targets', code: 'too_small' },
    ],
  ])('rejects %s', (_name, mutate, expected) => {
    expect(errorsAfter(mutate)).toContainEqual(expect.objectContaining(expected));
  });
});

describe('validateVideoSpec: cross-references', () => {
  it.each<[string, (spec: Required<VideoSpecInput>) => void, Partial<SpecError>]>([
    [
      'a beat in an unknown chapter',
      (spec) => (at(spec.story.beats, 0).chapterId = 'nope'),
      { path: '$.story.beats[0].chapterId', code: 'unknown_reference' },
    ],
    [
      'duplicate beat ids',
      (spec) => (at(spec.story.beats, 2).id = 'bucket-intro'),
      { path: '$.story.beats[2].id', code: 'duplicate_id' },
    ],
    [
      'beats that go back to an earlier chapter',
      (spec) => (at(spec.story.beats, 2).chapterId = 'flood'),
      { path: '$.story.beats[2].chapterId', code: 'chapter_order' },
    ],
    [
      'a payoff before its question',
      (spec) =>
        Object.assign(spec.story, {
          plantedQuestion: { text: 'Why?', beatId: 'bucket-empty', payoffBeatId: 'hook' },
        }),
      { path: '$.story.plantedQuestion.payoffBeatId', code: 'payoff_not_after_question' },
    ],
    [
      'a payoff in the same beat as the question',
      (spec) =>
        Object.assign(spec.story, {
          plantedQuestion: { text: 'Why?', beatId: 'hook', payoffBeatId: 'hook' },
        }),
      { code: 'payoff_not_after_question' },
    ],
    [
      'a rejected alternative in an unknown beat',
      (spec) => Object.assign(spec.story, { rejectedAlternative: { beatId: 'x', summary: 's' } }),
      { path: '$.story.rejectedAlternative.beatId', code: 'unknown_reference' },
    ],
    [
      'a story clock keyframe for an unknown beat',
      (spec) => (clockKeyframes(spec)[0] = { beatId: 'nope', value: 60 }),
      { path: '$.story.heroMetric.storyClock.keyframes[0].beatId', code: 'unknown_reference' },
    ],
    [
      'a story clock keyframe on the first beat',
      (spec) => (clockKeyframes(spec)[0] = { beatId: 'hook', value: 60 }),
      { path: '$.story.heroMetric.storyClock.keyframes[0].beatId', code: 'clock_keyframe_order' },
    ],
    [
      'story clock keyframes out of story order',
      (spec) => clockKeyframes(spec).push({ beatId: 'bucket-intro', value: 60 }),
      { path: '$.story.heroMetric.storyClock.keyframes[1].beatId', code: 'clock_keyframe_order' },
    ],
    [
      'two story clock keyframes for one beat',
      (spec) => clockKeyframes(spec).push({ beatId: 'bucket-empty', value: 150 }),
      { path: '$.story.heroMetric.storyClock.keyframes[1].beatId', code: 'duplicate_id' },
    ],
    [
      'a headline anchored to a word not in its narration',
      (spec) => {
        const headline = at(spec.script, 0).headline;
        if (headline) headline.at = { type: 'word_text', text: 'bucket' };
      },
      { path: '$.script[0].headline.at', code: 'anchor_out_of_range' },
    ],
    [
      'a script missing a beat',
      (spec) => spec.script.pop(),
      { path: '$.script', code: 'missing_beat' },
    ],
    [
      'scenes out of story order',
      (spec) => spec.scenes.reverse(),
      { path: '$.scenes[0].beatId', code: 'beat_order' },
    ],
    [
      'two formula cards',
      (spec) => (at(spec.script, 0).formulaCard = { latex: 'x' }),
      { path: '$.script[2].formulaCard', code: 'too_many_formula_cards' },
    ],
    [
      'duplicate element and pattern ids in a beat',
      (spec) => (at(at(spec.scenes, 0).patterns, 0).id = 'client'),
      { path: '$.scenes[0].patterns[0].id', code: 'duplicate_id' },
    ],
    [
      'an event target outside the beat',
      (spec) => (at(at(spec.scenes, 2).events, 0).targets = ['api']),
      { path: '$.scenes[2].events[0].targets[0]', code: 'unknown_reference' },
    ],
    [
      'an inner target whose instance is an element, not a pattern',
      (spec) => (at(at(spec.scenes, 0).events, 0).targets = ['client/resource']),
      { path: '$.scenes[0].events[0].targets[0]', code: 'unknown_reference' },
    ],
    [
      'a focus id outside the beat',
      (spec) => (at(spec.scenes, 2).focus = ['ghost']),
      { path: '$.scenes[2].focus[0]', code: 'unknown_reference' },
    ],
    [
      'continuesPrevious on the first beat',
      (spec) => (at(spec.scenes, 0).continuesPrevious = true),
      { path: '$.scenes[0].continuesPrevious', code: 'continues_without_previous' },
    ],
    [
      'a word index past the narration',
      (spec) => (at(at(spec.scenes, 0).events, 0).at = { type: 'word', index: 10 }),
      { path: '$.scenes[0].events[0].at', code: 'anchor_out_of_range' },
    ],
    [
      'a word-text anchor whose occurrence is missing',
      (spec) =>
        (at(at(spec.scenes, 2).events, 0).at = { type: 'word_text', text: 'no', occurrence: 4 }),
      { path: '$.scenes[2].events[0].at', code: 'anchor_out_of_range' },
    ],
    [
      'timing with the wrong word count',
      (spec) => at(spec.timing.beats, 1).words.pop(),
      { path: '$.timing.beats[1].words', code: 'timing_word_count' },
    ],
    [
      'overlapping beat timings',
      (spec) => (at(spec.timing.beats, 1).startSec = 3.5),
      { path: '$.timing.beats[1].startSec', code: 'timing_overlap' },
    ],
    [
      'a timed word outside its beat',
      (spec) => (at(at(spec.timing.beats, 0).words, 9).endSec = 4.5),
      { path: '$.timing.beats[0].words[9]', code: 'timing_word_outside_beat' },
    ],
    [
      'a cached event time for a missing event',
      (spec) => (at(spec.timing.events, 0).eventIndex = 5),
      { path: '$.timing.events[0].eventIndex', code: 'unknown_reference' },
    ],
  ])('rejects %s', (_name, mutate, expected) => {
    expect(errorsAfter(mutate)).toContainEqual(expect.objectContaining(expected));
  });

  it('lets a continuing beat target the previous beat’s elements', () => {
    // Fixture beat 2 continues beat 1 and dims "api"; breaking the chain makes it unknown.
    expect(errorsAfter(() => undefined)).toEqual([]);
    expect(errorsAfter((spec) => (at(spec.scenes, 1).continuesPrevious = false))).toContainEqual(
      expect.objectContaining({ path: '$.scenes[1].events[1].targets[0]' }),
    );
  });

  it('skips anchor checks until the script exists', () => {
    const spec = without(validSpec(), 'script', 'timing');
    at(at(spec.scenes, 0).events, 0).at = { type: 'word', index: 999 };
    expect(validateVideoSpec(spec).ok).toBe(true);
  });
});

describe('validateVideoSpec: warnings', () => {
  const offTarget = (spec: Required<VideoSpecInput>) => (at(spec.story.beats, 0).targetSec = 40);

  it('reports none for the valid fixture', () => {
    expect(validateVideoSpec(validSpec())).toMatchObject({ ok: true, errors: [], warnings: [] });
  });

  it('warns, without failing, when beat seconds drift from the target length', () => {
    const result = validateVideoSpec(mutated(offTarget));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: '$.story.beats', code: 'target_length_mismatch' }),
    ]);
  });

  it('allows drift within the tolerance', () => {
    // Fixture beats sum to 45 s; 49 s is within 10%.
    const result = validateVideoSpec(mutated((spec) => (at(spec.story.beats, 0).targetSec = 19)));
    expect(result.warnings).toEqual([]);
  });

  it('reports warnings alongside cross-reference errors', () => {
    const result = validateVideoSpec(
      mutated((spec) => {
        offTarget(spec);
        at(spec.story.beats, 0).chapterId = 'nope';
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.spec).toBeUndefined();
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'unknown_reference' }));
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'target_length_mismatch' }),
    );
  });

  it('reports no warnings when the structure does not parse', () => {
    const result = validateVideoSpec(
      mutated((spec) => {
        offTarget(spec);
        Object.assign(spec.meta, { topicClass: 'gossip' });
      }),
    );
    expect(result).toMatchObject({ ok: false, warnings: [] });
  });
});

describe('validateRenderableVideoSpec', () => {
  it('requires script and scenes', () => {
    const spec = without(validSpec(), 'scenes');
    const result = validateRenderableVideoSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContainEqual(expect.objectContaining({ path: '$.scenes' }));
  });

  it('accepts a spec without timing (estimated preview)', () => {
    const spec = without(validSpec(), 'timing');
    expect(validateRenderableVideoSpec(spec).ok).toBe(true);
  });
});

describe('toJsonPath', () => {
  it('formats keys and indexes', () => {
    expect(toJsonPath(['scenes', 2, 'events', 0, 'at'])).toBe('$.scenes[2].events[0].at');
    expect(toJsonPath(['props', 'my-key'])).toBe('$.props["my-key"]');
    expect(toJsonPath([])).toBe('$');
  });
});
