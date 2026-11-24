import {
  GeneratorOutputSchema,
  generatorScene,
  narrationWords,
  validateVideoSpec,
  type BeatScene,
  type VideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import type { FixtureTopicId } from '../fixture-topics.ts';
import { generatorCheck } from './check.ts';
import { generatorUserMessage, scaleLine } from './input.ts';
import {
  fixtureScriptedSpec,
  recordedNotes,
  storeBoard,
  versusBoard,
  type FixtureBoard,
} from './testing.ts';

function specOf(topic: FixtureTopicId): VideoSpec {
  const result = validateVideoSpec(fixtureScriptedSpec(topic));
  if (!result.spec) throw new Error(`the ${topic} fixture spec is invalid`);
  return result.spec;
}

const rateLimiter = specOf('rate-limiter');
const tokenizer = specOf('tokenizer');

function sceneOf(spec: VideoSpec, index: number, board: FixtureBoard): BeatScene {
  const beat = spec.story.beats[index];
  if (!beat) throw new Error(`no beat ${index}`);
  return generatorScene(GeneratorOutputSchema.parse(board), beat);
}

function message(
  topic: FixtureTopicId,
  beatIndex: number,
  scenes: (BeatScene | undefined)[] = [],
  spec = topic === 'tokenizer' ? tokenizer : rateLimiter,
) {
  return generatorUserMessage({ spec, scenes, beatIndex, notes: recordedNotes(topic) });
}

/** One `## TITLE ...` section's body. */
function sectionOf(text: string, title: string): string | undefined {
  const start = text.indexOf(`## ${title}`);
  if (start < 0) return undefined;
  const body = text.slice(text.indexOf('\n', start) + 1);
  const end = body.indexOf('\n## ');
  return end < 0 ? body : body.slice(0, end);
}

const storeScene = sceneOf(rateLimiter, 2, storeBoard());
const versusScene = sceneOf(tokenizer, 1, versusBoard());

describe('the boards these messages build on are clean', () => {
  it('rate limiter beat3 and tokenizer b2', () => {
    const check = (
      spec: VideoSpec,
      topic: FixtureTopicId,
      beatIndex: number,
      board: FixtureBoard,
    ) => generatorCheck({ spec, scenes: [], beatIndex, notes: recordedNotes(topic) })(board);
    expect(check(rateLimiter, 'rate-limiter', 2, storeBoard())).toEqual([]);
    expect(check(tokenizer, 'tokenizer', 1, versusBoard())).toEqual([]);
  });
});

describe('scaleLine', () => {
  it('names the room left above the readable scale, in four steps', () => {
    expect(scaleLine(0.74, 0.75)).toContain('room is none:');
    expect(scaleLine(0.78, 0.75)).toContain('room is almost none:');
    expect(scaleLine(0.85, 0.75)).toContain('room is little:');
    expect(scaleLine(1, 0.75)).toContain('room is some.');
    expect(scaleLine(1, 0.75)).toContain('exiting one frees no room');
  });
});

describe('generatorUserMessage', () => {
  it('numbers every narration word as an anchor counts it, with its start in seconds', () => {
    const text = message('rate-limiter', 0);
    const lines = (sectionOf(text, 'NARRATION WORDS') ?? '')
      .split('\n')
      .filter((l) => /^\d/.test(l));
    const narration = rateLimiter.script?.[0]?.narration ?? '';
    expect(lines).toHaveLength(narrationWords(narration).length);
    expect(lines[0]).toBe('0 Thirty-one 0.00');
    expect(lines.at(-1)).toMatch(/^23 now\. \d+\.\d\d$/);
  });

  it("gives a board's first beat its fixed layout mode, and no ON SCREEN list", () => {
    const text = message('rate-limiter', 0);
    const board = JSON.parse(sectionOf(text, 'BOARD') ?? '{}') as { layoutMode: { id: string } };
    expect(board.layoutMode.id).toBe('two_column');
    expect(text).not.toContain('## ON SCREEN');
    expect(text).not.toContain('## ZOOM FROM');
  });

  it('gives a continuing beat what is on screen, the focus, the units and the last narration', () => {
    const text = message('rate-limiter', 3, [undefined, undefined, storeScene]);
    const onScreen = sectionOf(text, 'ON SCREEN') ?? '';
    expect(onScreen).toContain('- own (node_card) "Own bucket": present;');
    expect(onScreen).toContain('- one (tag) "One bucket": present;');
    expect(onScreen).toContain('focus: shared');
    expect(onScreen).toMatch(/units on screen: \d+ of at most \d+/);
    expect(onScreen).toMatch(
      /space left: the board is drawn at \d+% of full size and text stays readable down to 75%/,
    );
    expect(sectionOf(text, 'PREVIOUS BEAT')).toContain('Why not give each gateway node');
    const board = JSON.parse(sectionOf(text, 'BOARD') ?? '{}') as { layoutMode: { id: string } };
    expect(board.layoutMode.id).toBe('versus_split');
  });

  it('lists the research numbers of this beat and the earlier beats on its board', () => {
    const research = (index: number, scenes: (BeatScene | undefined)[] = []) =>
      JSON.parse(sectionOf(message('rate-limiter', index, scenes), 'RESEARCH') ?? '{}') as {
        facts: { id: string }[];
        numbers: { id: string }[];
      };
    const beat3 = research(2).numbers.map((n) => n.id);
    expect(beat3).toEqual(expect.arrayContaining(['num-3', 'num-4']));
    expect(research(3, [undefined, undefined, storeScene]).numbers.map((n) => n.id)).toEqual(
      expect.arrayContaining(beat3),
    );
    expect(research(3).facts.map((f) => f.id)).toEqual(['fact-6', 'fact-5']);
  });

  it('lists the terms introduced so far, and the ones a label must not name yet', () => {
    const terms = JSON.parse(sectionOf(message('tokenizer', 0), 'TERMS') ?? '{}') as {
      introduced: { term: string; plainMeaning: string | null }[];
      notYet: string[];
    };
    expect(terms.introduced.map((t) => t.term)).toEqual(['token']);
    expect(terms.introduced[0]?.plainMeaning).toBeTruthy();
    expect(terms.notYet).toEqual(expect.arrayContaining(['vocabulary', 'pre-tokenization']));
  });

  it("gives a semantic-zoom beat the previous board's elements to zoom from", () => {
    const zoom = sectionOf(message('tokenizer', 2, [undefined, versusScene]), 'ZOOM FROM') ?? '';
    expect(zoom).toContain('- pieces (node_card) "Subword pieces"');
    expect(zoom).toContain('- chars (node_card) "Characters"');
  });

  it('tells the final beat which words the ending card covers', () => {
    const last = (rateLimiter.story.beats.length ?? 1) - 1;
    expect(sectionOf(message('rate-limiter', last), 'NARRATION WORDS')).toMatch(
      /The ending card covers the last sentence \(words \d+ on, from [\d.]+ s\): anchor nothing there\./,
    );
    expect(sectionOf(message('rate-limiter', 0), 'NARRATION WORDS')).not.toContain('ending card');
  });

  it('lists the run’s logo slots', () => {
    const spec = { ...rateLimiter, logos: [{ id: 'logo_acme', label: 'Acme' }] };
    const board = JSON.parse(sectionOf(message('rate-limiter', 0, [], spec), 'BOARD') ?? '{}') as {
      logoSlots: unknown[];
    };
    expect(board.logoSlots).toEqual([{ id: 'logo_acme', label: 'Acme' }]);
  });

  it('ends with the feedback when a board is drawn again, and has none otherwise', () => {
    const text = generatorUserMessage({
      spec: rateLimiter,
      scenes: [],
      beatIndex: 0,
      notes: recordedNotes('rate-limiter'),
      feedback: '  Move the stat card in later.  ',
    });
    expect(
      text.endsWith(
        '## FEEDBACK (draw this board again and fix this)\nMove the stat card in later.',
      ),
    ).toBe(true);
    expect(message('rate-limiter', 0)).not.toContain('## FEEDBACK');
  });

  it('is the same for the same input (no clock, no randomness)', () => {
    expect(message('rate-limiter', 3, [undefined, undefined, storeScene])).toBe(
      message('rate-limiter', 3, [undefined, undefined, storeScene]),
    );
  });
});

describe('what the model sees (snapshots: review the diff)', () => {
  it('rate limiter beat4, continuing beat3’s board', async () => {
    await expect(
      message('rate-limiter', 3, [undefined, undefined, storeScene]),
    ).toMatchFileSnapshot('./__snapshots__/rate-limiter-beat4.message.txt');
  });

  it('tokenizer b3, a semantic zoom from b2’s board', async () => {
    await expect(message('tokenizer', 2, [undefined, versusScene])).toMatchFileSnapshot(
      './__snapshots__/tokenizer-b3.message.txt',
    );
  });
});
