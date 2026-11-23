import {
  ResearchNotesSchema,
  type RenderableVideoSpec,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { goldenFixtures, goldenRateLimiterSpec } from '../../fixtures/index.ts';
import { layerWarnings } from './layer-checks.ts';
import { screenTextWarnings } from './screen-checks.ts';

const C = ['source-1#chunk-1'];

/** Notes for the golden rate limiter's numbers (invented, like the fixture). */
function notes(): ResearchNotes {
  const number = (id: string, value: string, unit: string) => ({
    id,
    value,
    unit,
    context: '<example-context>',
    sourceChunkId: C[0],
  });
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'A bucket refills.',
      sourceChunkIds: C,
      steps: [{ text: 'Spend one.', sourceChunkIds: C }],
    },
    plainSummary: 'Each user gets a few tries a minute.',
    analogies: [{ analogy: 'A ticket roll.', matches: 'Tries.', breaksDown: 'No refill.' }],
    glossary: [{ term: 'token bucket', plainMeaning: 'A refilling allowance.', sourceChunkIds: C }],
    facts: [
      { id: 'fact-1', statement: 'A bucket refills.', sourceChunkIds: C, confidence: 'high' },
    ],
    numbers: [
      number('num-1', '10,000', 'requests per second'),
      number('num-2', '100', 'tokens'),
      number('num-3', '1', 'minute'),
      number('num-4', '200', 'requests'),
      number('num-5', '60', 'seconds'),
    ],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: 'A flood of 10,000 requests a second.', sourceChunkIds: C },
      { situation: 'Each user gets 100 tokens.', sourceChunkIds: C },
    ],
    openQuestions: [],
  });
}

type Change = (spec: RenderableVideoSpec) => void;

/** The research numbers each golden beat cites, as the Director would list them. */
const CITED: Readonly<Record<string, string[]>> = {
  hook: ['num-1'],
  bucket: ['num-2', 'num-3'],
  payoff: ['num-1'],
};

function golden(change: Change = () => undefined): RenderableVideoSpec {
  const spec = structuredClone(goldenRateLimiterSpec);
  for (const beat of spec.story.beats) beat.factIds = CITED[beat.id] ?? [];
  change(spec);
  return spec;
}

const at = <T>(list: T[], i: number): T => {
  const found = list[i];
  if (!found) throw new Error(`nothing at ${i}`);
  return found;
};

/** Props of element `j` in scene `i`. */
const props = (spec: RenderableVideoSpec, i: number, j: number) =>
  at(at(spec.scenes, i).elements, j).props;

const codes = (spec: RenderableVideoSpec, withNotes = true) =>
  screenTextWarnings(spec, withNotes ? { notes: notes() } : {}).map((w) => `${w.path} ${w.code}`);

describe('screen checks: the golden fixtures pass', () => {
  it.each(goldenFixtures.map((f) => [f.spec.meta.id, f.spec] as const))('%s', (_, spec) => {
    expect(screenTextWarnings(spec)).toEqual([]);
    expect(layerWarnings(spec)).toEqual([]);
  });

  it('the rate limiter passes the number check against its notes too', () => {
    expect(codes(golden())).toEqual([]);
  });
});

describe('script_text_missing / script_text_changed', () => {
  it('flags a script tag that is not on the board', () => {
    const spec = golden((s) => at(s.scenes, 0).elements.splice(4, 1));
    expect(codes(spec, false)).toEqual(['$.scenes[0].elements script_text_missing']);
  });

  it('flags a tag that retypes the script, and one of its own', () => {
    const spec = golden((s) => (props(s, 0, 4).text = '502'));
    expect(codes(spec, false)).toEqual([
      '$.scenes[0].elements[4].props.text script_text_changed',
      '$.scenes[0].elements script_text_missing',
    ]);
  });

  it('compares tags without case (they are drawn upper case)', () => {
    const spec = golden((s) => (at(s.script, 5).tags = ['100 total']));
    expect(codes(spec, false)).toEqual([]);
  });

  it('matches a stat card on its value and label, and a command bubble on its text', () => {
    const card = { value: '10k/s', label: 'peak requests', sourceRef: 'num-1' };
    const element = {
      id: 'peak',
      primitive: 'stat_card',
      props: { value: '10k/s', label: 'peak requests', source: '<example-source>' },
    };
    const ok = golden((s) => {
      at(s.script, 0).statCards = [card];
      at(s.scenes, 0).elements.push(element);
    });
    expect(codes(ok, false)).toEqual([]);
    const relabelled = golden((s) => {
      at(s.script, 0).statCards = [card];
      at(s.scenes, 0).elements.push({ ...element, props: { ...element.props, label: 'at peak' } });
    });
    expect(codes(relabelled, false)).toEqual([
      '$.scenes[0].elements[5].props.value script_text_changed',
      '$.scenes[0].elements script_text_missing',
    ]);
    const bubble = golden((s) => (props(s, 3, 3).text = 'INCR rate:user'));
    expect(codes(bubble, false)).toContain(
      '$.scenes[3].elements[3].props.text script_text_changed',
    );
  });
});

describe('screen_number_not_in_notes', () => {
  it('flags a displayed number that is no research value of the beat', () => {
    const spec = golden((s) => (props(s, 0, 3).value = 12_000));
    expect(codes(spec)).toEqual(['$.scenes[0].elements[3].props.value screen_number_not_in_notes']);
  });

  it('compares seconds with research times converted by code (60 s = one minute)', () => {
    expect(codes(golden())).toEqual([]);
    const ninety = golden((s) => (props(s, 2, 2).durationSec = 90));
    expect(codes(ninety)).toEqual([
      '$.scenes[2].elements[2].props.durationSec screen_number_not_in_notes',
    ]);
  });

  it('accepts a time the beat cites in another unit only when it converts exactly', () => {
    const spec = golden((s) => {
      at(s.story.beats, 2).factIds = ['num-2', 'num-5'];
      props(s, 2, 2).durationSec = 60;
    });
    expect(codes(spec)).toEqual([]);
  });

  it('skips identifiers in labels (p99, HTTP 429) and flags real quantities', () => {
    const ids = golden((s) => (props(s, 0, 1).subtitle = 'HTTP 429 at p99'));
    expect(codes(ids)).toEqual([]);
    const qty = golden((s) => (props(s, 0, 1).subtitle = '12,000 req/s'));
    expect(codes(qty)).toEqual([
      '$.scenes[0].elements[1].props.subtitle screen_number_not_in_notes',
    ]);
  });

  it('allows a number an earlier beat of the same board cites, and no other board', () => {
    const cite: Change = (s) => (at(s.story.beats, 4).factIds = ['num-4']);
    const sameBoard = golden((s) => {
      cite(s);
      props(s, 5, 0).subtitle = '200 got through';
    });
    expect(codes(sameBoard)).toEqual([]);
    const otherBoard = golden((s) => {
      cite(s);
      props(s, 3, 1).subtitle = '200 got through';
    });
    expect(codes(otherBoard)).toEqual([
      '$.scenes[3].elements[1].props.subtitle screen_number_not_in_notes',
    ]);
  });
});

describe('label_term_too_early', () => {
  it('flags a label naming a term a later beat introduces, and passes from that beat on', () => {
    const later = golden((s) => (at(s.story.beats, 2).newTerms = ['token bucket']));
    const early = golden((s) => {
      at(s.story.beats, 2).newTerms = ['token bucket'];
      props(s, 0, 1).subtitle = 'token buckets';
    });
    expect(codes(later, false)).toEqual([]);
    expect(codes(early, false)).toEqual([
      '$.scenes[0].elements[1].props.subtitle label_term_too_early',
    ]);
  });
});

describe('example_label_unmarked', () => {
  const example = (subtitle: string) =>
    golden((s) => {
      at(s.story.beats, 0).exampleNumbers = true;
      props(s, 0, 1).subtitle = subtitle;
    });

  it('accepts an example number in a label that starts with "e.g."', () => {
    expect(codes(example('e.g. 24 nodes'), false)).toEqual([]);
  });

  it('flags one without it', () => {
    expect(codes(example('24 nodes'), false)).toEqual([
      '$.scenes[0].elements[1].props.subtitle example_label_unmarked',
    ]);
  });
});

describe('layerWarnings', () => {
  it('flags the same pattern as the focus of two consecutive beats', () => {
    const spec = golden((s) => {
      const payoff = at(s.scenes, 6);
      Object.assign(at(s.scenes, 5), {
        continuesPrevious: false,
        elements: [],
        events: [],
        patterns: structuredClone(payoff.patterns).map((p) => ({ ...p, id: 'flood-a' })),
        focus: ['flood-a'],
      });
    });
    expect(layerWarnings(spec).map((w) => `${w.path} ${w.code}`)).toEqual([
      '$.scenes[6].patterns[0] pattern_repeated_on_focus',
    ]);
  });

  it('allows one beat that is only a stat card, and flags the second', () => {
    const card = {
      id: 'n',
      primitive: 'stat_card',
      props: { value: '1', label: 'x', source: 'y' },
    };
    const one = golden((s) => Object.assign(at(s.scenes, 2), { elements: [card], events: [] }));
    expect(layerWarnings(one)).toEqual([]);
    const two = golden((s) => {
      Object.assign(at(s.scenes, 2), { elements: [card], events: [] });
      Object.assign(at(s.scenes, 3), { elements: [], events: [] });
    });
    expect(layerWarnings(two).map((w) => `${w.path} ${w.code}`)).toEqual([
      '$.scenes[3] static_beats',
    ]);
  });
});
