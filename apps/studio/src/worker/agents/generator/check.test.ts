import {
  GeneratorOutputSchema,
  generatorScene,
  validateVideoSpec,
  type BeatScene,
  type VideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { generatorAssetSwaps, generatorCheck, type GeneratorCheckDeps } from './check.ts';
import {
  countBoard,
  fixtureScriptedSpec,
  hookBoard,
  recordedNotes,
  storeBoard,
  type FixtureBoard as Board,
} from './testing.ts';

const spec: VideoSpec = (() => {
  const result = validateVideoSpec(fixtureScriptedSpec('rate-limiter'));
  if (!result.spec) throw new Error('the fixture spec is invalid');
  return result.spec;
})();

const word = (index: number) => ({ type: 'word', index }) as const;

/** Pins that make the board too wide: its labels shrink below readable size. */
function crowdedCountBoard(): Board {
  return {
    elements: [
      {
        id: 'count',
        primitive: 'tag',
        props: { text: 'Shared count', semantic: 'focus', pin: { to: 'shared', side: 'left' } },
      },
      {
        id: 'double',
        primitive: 'tag',
        props: { text: 'Double admit', semantic: 'problem', pin: { to: 'own', side: 'bottom' } },
      },
    ],
    events: [
      { at: word(5), action: 'enter', targets: ['count'] },
      { at: word(26), action: 'enter', targets: ['double'] },
      { at: word(26), action: 'reject', targets: ['own'] },
    ],
    focus: ['own'],
  };
}

const notes = recordedNotes('rate-limiter');

const deps = (beatIndex: number, scenes: (BeatScene | undefined)[] = []): GeneratorCheckDeps => ({
  spec,
  scenes,
  beatIndex,
  notes,
});

const issues = (beatIndex: number, value: unknown, scenes?: (BeatScene | undefined)[]) =>
  generatorCheck(deps(beatIndex, scenes))(value);

const sceneFor = (index: number, value: unknown): BeatScene => {
  const beat = spec.story.beats[index];
  if (!beat) throw new Error(`no beat ${index}`);
  return generatorScene(GeneratorOutputSchema.parse(value), beat);
};

const paths = (list: { path: string; code?: string }[]) => list.map((i) => `${i.path} ${i.code}`);

describe('generatorCheck: clean boards', () => {
  it('passes a clean first board, reporting nothing from beats not generated yet', () => {
    expect(paths(issues(0, hookBoard()))).toEqual([]);
  });

  it('passes a clean continuation given the board it continues', () => {
    expect(paths(issues(2, storeBoard()))).toEqual([]);
    expect(
      paths(issues(3, countBoard(), [undefined, undefined, sceneFor(2, storeBoard())])),
    ).toEqual([]);
  });

  it('returns nothing for an answer that fails the output schema (the client reports it)', () => {
    expect(issues(0, { elements: 'nope' })).toEqual([]);
  });
});

describe('generatorCheck: seeded faults, with paths into the answer', () => {
  it('unknown primitive (registry error)', () => {
    const board = hookBoard();
    board.elements[0] = { ...board.elements[0]!, primitive: 'node_cardz' };
    expect(paths(issues(0, board))).toContain('$.elements[0].primitive unknown_reference');
  });

  it('recover without a reject (timeline warning)', () => {
    const board = hookBoard();
    board.events.push({ at: word(20), action: 'recover', targets: ['limiter'] });
    expect(paths(issues(0, board))).toContain('$.events[6] recover_without_reject');
  });

  it('a zone the layout mode does not have (layout warning)', () => {
    const board = hookBoard();
    board.elements[1] = { ...board.elements[1]!, zone: 'hub' };
    expect(paths(issues(0, board))).toContain('$ unknown_zone');
  });

  it('no focus (beat check)', () => {
    expect(paths(issues(0, { ...hookBoard(), focus: [] }))).toContain('$.focus focus_missing');
  });

  it('an issue this beat causes in an earlier beat of its board, reported as such', () => {
    const scenes = [undefined, undefined, sceneFor(2, storeBoard())];
    const found = issues(3, crowdedCountBoard(), scenes);
    expect(paths(found)).toEqual(['$.scenes[2] text_too_small']);
  });

  it('a board made too small by a continuing beat says what that beat can change', () => {
    const scenes = [undefined, undefined, sceneFor(2, storeBoard())];
    const [found] = issues(3, crowdedCountBoard(), scenes);
    expect(found?.message).toMatch(/^Your additions shrink this board below readable: The board/);
    expect(found?.message).toMatch(/fits at \d+% \(labels [\d.]+px; readable needs 75%\)/);
    expect(found?.message).toContain('exiting an element frees no room');
    expect(found?.message).toContain('Never drop or reword a script item.');
    expect(found?.message).not.toContain('Use fewer or smaller elements');
  });

  it('a board pushed over its element limit by a continuing beat says pins do not count', () => {
    const board = countBoard();
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      board.elements.push({
        id: `extra-${n}`,
        primitive: 'node_card',
        props: { title: `Node ${n}` },
      });
    }
    const scenes = [undefined, undefined, sceneFor(2, storeBoard())];
    const found = issues(3, board, scenes).find((i) => i.code === 'too_many_elements');
    expect(found?.path).toBe('$.scenes[2]');
    expect(found?.message).toMatch(
      /^Your additions put this board over its element limit: \d+ elements in versus_split/,
    );
    expect(found?.message).toContain('Pinned elements do not count as elements here');
    expect(found?.message).toContain('pin each new script tag to an element already ON SCREEN');
    expect(found?.message).not.toContain('Split the beat');
  });

  it('keeps the plain "caused in an earlier beat" message for other issues', () => {
    const board = countBoard();
    board.elements.push(
      { id: 'link', primitive: 'connector', props: { from: 'own', to: 'shared' } },
      { id: 'note', primitive: 'tag', props: { text: 'Note', pin: { to: 'link', side: 'top' } } },
    );
    board.events.push({ at: word(30), action: 'enter', targets: ['link', 'note'] });
    const scenes = [undefined, undefined, sceneFor(2, storeBoard())];
    const found = issues(3, board, scenes).filter((i) => i.code === 'pin_unresolved');
    expect(found[0]?.message).toMatch(
      /^Caused in an earlier beat of this board by this answer: "note" is pinned to a side/,
    );
  });

  it('an inherited element declared again (chain duplicate_id)', () => {
    const board = countBoard();
    board.elements.push({
      id: 'shared',
      primitive: 'node_card',
      props: { title: 'Store' },
    });
    const scenes = [undefined, undefined, sceneFor(2, storeBoard())];
    expect(paths(issues(3, board, scenes))).toContain('$.elements[2].id duplicate_id');
  });
});

describe('generatorCheck: on-screen text (with the recorded research notes)', () => {
  it('a label with a number the research does not give', () => {
    const board = hookBoard();
    board.elements[0]!.props.subtitle = '12,000 orders';
    expect(paths(issues(0, board))).toEqual([
      '$.elements[0].props.subtitle screen_number_not_in_notes',
    ]);
  });

  it("a script tag retyped, and the script's tag then missing", () => {
    const board = hookBoard();
    board.elements[2]!.props.text = 'Checkout broke';
    expect(paths(issues(0, board))).toEqual([
      '$.elements[2].props.text script_text_changed',
      '$.elements script_text_missing',
    ]);
  });
});

describe('generatorCheck: assets', () => {
  it('reports an unknown asset id as soft', () => {
    const board = hookBoard();
    board.elements[0]!.props.icon = 'quantum_bus';
    const found = issues(0, board).filter((i) => i.code === 'unknown_asset');
    expect(found).toEqual([
      expect.objectContaining({ path: '$.elements[0].props.icon', soft: true }),
    ]);
  });

  it('swaps a near-identical id before checking, and lists the swap for the step to log', () => {
    const board = hookBoard();
    board.elements[1]!.props.icon = 'shields';
    expect(paths(issues(0, board))).toEqual([]);
    const output = GeneratorOutputSchema.parse(board);
    expect(generatorAssetSwaps(output, deps(0))).toEqual([
      { path: ['elements', 1, 'props', 'icon'], from: 'shields', to: 'shield' },
    ]);
  });
});
