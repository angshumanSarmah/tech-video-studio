import { describe, expect, it } from 'vitest';
import type { VideoSpecInput } from './shape.ts';
import { validSpec } from './test-fixtures.ts';
import {
  toJsonPath,
  validateRenderableVideoSpec,
  validateVideoSpec,
  type SpecError,
} from './validate.ts';

/** Builds a spec from the valid fixture with `mutate` applied, and returns its errors. */
function errorsAfter(mutate: (spec: Required<VideoSpecInput>) => void): SpecError[] {
  const spec = validSpec() as Required<VideoSpecInput>;
  mutate(spec);
  const result = validateVideoSpec(spec);
  return result.ok ? [] : result.errors;
}

/** The spec with optional layers removed. */
function without(
  spec: VideoSpecInput,
  ...layers: ('script' | 'scenes' | 'timing')[]
): VideoSpecInput {
  for (const layer of layers) delete spec[layer];
  return spec;
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
      'beat seconds far from the target length',
      (spec) => (at(spec.story.beats, 0).targetSec = 40),
      { path: '$.story.beats', code: 'beat_seconds_mismatch' },
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
