import {
  GeneratorOutputSchema,
  generatorScene,
  validateVideoSpec,
  type BeatScene,
  type VideoSpec,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { generatorAssetSwaps, generatorCheck, type GeneratorCheckDeps } from './check.ts';
import { fixtureScriptedSpec, recordedNotes } from './testing.ts';

const spec: VideoSpec = (() => {
  const result = validateVideoSpec(fixtureScriptedSpec('rate-limiter'));
  if (!result.spec) throw new Error('the fixture spec is invalid');
  return result.spec;
})();

const source = spec.script?.[0]?.source ?? '';
const word = (index: number) => ({ type: 'word', index }) as const;

/** A board as the model writes it, loose enough for tests to seed faults into. */
type Board = {
  elements: { id: string; primitive: string; props: Record<string, unknown>; zone?: string }[];
  events: { at: { type: 'word'; index: number }; action: string; targets: string[] }[];
  focus: string[];
};

/** A clean board for the hook (beat1, two_column): the script's tags and stat card placed. */
function hookBoard(): Board {
  return {
    elements: [
      {
        id: 'shop',
        primitive: 'node_card',
        props: { title: 'Checkout', icon: 'shopping_bag' },
        zone: 'left',
      },
      {
        id: 'limiter',
        primitive: 'node_card',
        props: { title: 'Rate limiter', icon: 'shield' },
        zone: 'right',
      },
      {
        id: 'errors',
        primitive: 'tag',
        props: { text: 'Checkout errors', semantic: 'problem', pin: { to: 'shop', side: 'top' } },
      },
      {
        id: 'traffic',
        primitive: 'tag',
        props: {
          text: 'Too much traffic',
          semantic: 'problem',
          pin: { to: 'shop', side: 'bottom' },
        },
      },
      {
        id: 'failed',
        primitive: 'stat_card',
        props: { value: '31%', label: 'checkouts failed', source },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(0), action: 'enter', targets: ['failed'] },
      { at: word(5), action: 'enter', targets: ['shop'] },
      { at: word(6), action: 'enter', targets: ['errors'] },
      { at: word(11), action: 'enter', targets: ['traffic'] },
      { at: word(16), action: 'enter', targets: ['limiter'] },
      { at: word(17), action: 'highlight', targets: ['limiter'] },
    ],
    focus: ['limiter'],
  };
}

/** A clean first board for beat3 (versus_split) and a clean continuation for beat4. */
function storeBoard(): Board {
  return {
    elements: [
      {
        id: 'own',
        primitive: 'node_card',
        props: { title: 'Own bucket', icon: 'server' },
        zone: 'left',
      },
      {
        id: 'shared',
        primitive: 'node_card',
        props: { title: 'Shared store', icon: 'database' },
        zone: 'right',
      },
      {
        id: 'one',
        primitive: 'tag',
        props: { text: 'One bucket', semantic: 'ok', pin: { to: 'shared', side: 'top' } },
      },
      {
        id: 'agree',
        primitive: 'tag',
        props: { text: 'All nodes agree', semantic: 'ok', pin: { to: 'shared', side: 'bottom' } },
      },
    ],
    events: [
      { at: word(5), action: 'enter', targets: ['own'] },
      { at: word(24), action: 'enter', targets: ['shared'] },
      { at: word(25), action: 'enter', targets: ['one'] },
      { at: word(28), action: 'enter', targets: ['agree'] },
    ],
    focus: ['shared'],
  };
}

function countBoard(): Board {
  return {
    elements: [
      {
        id: 'count',
        primitive: 'tag',
        props: { text: 'Shared count', semantic: 'focus', pin: { to: 'own', side: 'top' } },
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
    expect(found[0]?.message).toMatch(/^Caused in an earlier beat of this board by this answer: /);
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
