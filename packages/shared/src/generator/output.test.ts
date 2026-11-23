import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BeatSceneSchema } from '../spec/scene.ts';
import { GeneratorOutputSchema, generatorScene } from './output.ts';

const word = (index: number) => ({ type: 'word', index });

const board = {
  elements: [{ id: 'api', primitive: 'node_card', props: { title: '<example-title>' } }],
  patterns: [
    {
      id: 'lock',
      pattern: 'atomic_lock',
      params: { holdSec: 600, at: { arrive: word(2), lock: word(4) } },
    },
  ],
  events: [{ at: word(1), action: 'enter', targets: ['api'] }],
  focus: ['api'],
};

const issuePaths = (value: unknown) =>
  GeneratorOutputSchema.safeParse(value).error?.issues.map((i) => i.path.join('.')) ?? [];

describe('GeneratorOutputSchema', () => {
  it('fills defaults: a board without arrays or a transition is a cut with nothing on it', () => {
    expect(GeneratorOutputSchema.parse({})).toEqual({
      elements: [],
      patterns: [],
      events: [],
      focus: [],
      transitionIn: 'cut',
    });
  });

  it('keeps pattern params as written for the pattern registry to check', () => {
    expect(GeneratorOutputSchema.parse(board).patterns[0]?.params).toEqual(
      board.patterns[0]?.params,
    );
  });

  it('accepts only word index anchors on events', () => {
    const text = {
      ...board,
      events: [{ ...board.events[0], at: { type: 'word_text', text: 'api' } }],
    };
    const edge = {
      ...board,
      events: [{ ...board.events[0], at: { type: 'beat', edge: 'start' } }],
    };
    expect(issuePaths(text)).toContain('events.0.at.type');
    expect(issuePaths(edge)).toContain('events.0.at.type');
  });

  it("accepts only word index anchors in a pattern's params.at", () => {
    const params = { holdSec: 600, at: { arrive: { type: 'word_text', text: 'lock' } } };
    const value = { ...board, patterns: [{ ...board.patterns[0], params }] };
    expect(issuePaths(value)).toContain('patterns.0.params.at.arrive.type');
  });

  it('leaves out what the plan decides: beat id, kind, continuation and layout mode', () => {
    for (const key of ['beatId', 'kind', 'continuesPrevious', 'layoutMode']) {
      expect(GeneratorOutputSchema.safeParse({ ...board, [key]: 'x' }).success).toBe(false);
    }
  });

  it('takes optional missing-primitive requests', () => {
    const request = { name: '<example-name>', description: '<example-need>', fallbackUsed: 'tag' };
    const parsed = GeneratorOutputSchema.parse({ ...board, missingPrimitiveRequests: [request] });
    expect(parsed.missingPrimitiveRequests).toEqual([request]);
  });

  it('shows the model only the word anchor shape in its JSON Schema', () => {
    const json = JSON.stringify(z.toJSONSchema(GeneratorOutputSchema, { io: 'input' }));
    expect(json).not.toMatch(/word_text|"beat"|offsetSec/);
    expect(json).toContain('"const":"word"');
  });
});

describe('generatorScene', () => {
  const output = GeneratorOutputSchema.parse({ ...board, transitionIn: 'fade' });

  it("adds the plan's beat id, continuation and layout mode to the board", () => {
    const scene = generatorScene(output, {
      id: 'hook',
      continuesPrevious: false,
      layoutMode: 'centered_focus',
    });
    expect(scene).toMatchObject({
      beatId: 'hook',
      kind: 'board',
      layoutMode: 'centered_focus',
      continuesPrevious: false,
      transitionIn: 'fade',
    });
    expect(BeatSceneSchema.parse(scene)).toEqual(scene);
  });

  it('gives a continuing beat no layout mode (its board keeps the first beat’s)', () => {
    const scene = generatorScene(output, {
      id: 'next',
      continuesPrevious: true,
      layoutMode: 'grid',
    });
    expect(scene.layoutMode).toBeUndefined();
    expect(scene.continuesPrevious).toBe(true);
  });

  it('carries zoomFrom and drops missing-primitive requests', () => {
    const zoom = GeneratorOutputSchema.parse({
      ...board,
      transitionIn: 'zoom-in',
      zoomFrom: 'store',
      missingPrimitiveRequests: [{ name: 'n', description: 'd', fallbackUsed: 'tag' }],
    });
    const scene = generatorScene(zoom, { id: 'inside', continuesPrevious: false });
    expect(scene.zoomFrom).toBe('store');
    expect(scene).not.toHaveProperty('missingPrimitiveRequests');
    expect(scene).not.toHaveProperty('layoutMode');
  });
});
