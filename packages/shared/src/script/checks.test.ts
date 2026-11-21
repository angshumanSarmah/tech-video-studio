import { describe, expect, it } from 'vitest';
import { DirectorPlanSchema, type DirectorPlan } from '../director/plan.ts';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import { scriptProblems, sentences, wordBudgets } from './checks.ts';
import type { ScriptCheckContext } from './context.ts';
import { headlineWords } from './screen-checks.ts';
import { ScriptwriterOutputSchema, type ScriptwriterOutput } from './output.ts';

const C = ['source-1#chunk-1'];

/** Invented notes: three numbers (one dated incident) and a glossary of two terms. */
function notes(): ResearchNotes {
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'A queue drains at a fixed rate.',
      sourceChunkIds: C,
      steps: [{ text: 'Requests wait.', sourceChunkIds: C }],
    },
    plainSummary: 'Requests wait their turn.',
    analogies: [{ analogy: 'A ticket line.', matches: 'Order.', breaksDown: 'No tickets.' }],
    glossary: ['drain rate', 'backlog'].map((term) => ({
      term,
      plainMeaning: `What ${term} means.`,
      sourceChunkIds: C,
    })),
    facts: [
      { id: 'fact-1', statement: 'A queue absorbs bursts.', sourceChunkIds: C, confidence: 'high' },
    ],
    numbers: [
      { id: 'num-1', value: '500', unit: 'requests', context: 'burst', sourceChunkId: C[0] },
      { id: 'num-2', value: '2.5', unit: 'ms', context: 'wait', sourceChunkId: C[0] },
      {
        id: 'num-3',
        value: '2 million',
        unit: 'requests',
        context: 'flood',
        sourceChunkId: C[0],
        asOf: '9 May 2031',
      },
    ],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: 'A burst of 500 requests.', sourceChunkIds: C },
      { situation: 'Each waits 2.5 ms.', sourceChunkIds: C },
    ],
    openQuestions: [],
  });
}

/** Three beats of 10, 10 and 5 s; b1 is the hook (num-1), b2 introduces "backlog". */
function plan(): DirectorPlan {
  return DirectorPlanSchema.parse({
    meta: { title: 'Why queues shed load', topicClass: 'concept', format: 'full' },
    story: {
      chapters: [{ id: 'ch1', title: 'Queues' }],
      beats: [
        { id: 'b1', chapterId: 'ch1', intent: 'A burst.', targetSec: 10, hookNumberIds: ['num-1'] },
        { id: 'b2', chapterId: 'ch1', intent: 'It waits.', targetSec: 10, newTerms: ['backlog'] },
        {
          id: 'b3',
          chapterId: 'ch1',
          intent: 'The flood.',
          targetSec: 5,
          source: '<example-publisher>, 9 May 2031',
        },
      ],
      ending: { kind: 'callback_ending', cta: 'Send this to a friend.' },
    },
  });
}

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

/**
 * A passing script: 27, 25 and 13 words (budgets 23-31, 23-31, 11-16). b1 names the main term
 * ("queue", the topic title the video title names); b2 introduces "backlog" with a concept
 * headline and says its stat card's number.
 */
function output(): ScriptwriterOutput {
  return ScriptwriterOutputSchema.parse({
    script: [
      {
        beatId: 'b1',
        narration: `A burst of five hundred requests hits one queue. ${words(9)}. ${words(9)}.`,
      },
      {
        beatId: 'b2',
        narration: `The waiting requests form a backlog, a line of work. Each waits two point five milliseconds. ${words(9)}.`,
        headline: { text: 'Backlog = work waiting its turn', semantic: 'concept' },
        statCards: [{ value: '2.5 ms', label: 'wait per request', sourceRef: 'num-2' }],
        source: '<example-publisher> field guide',
      },
      {
        beatId: 'b3',
        narration: `Then two million requests arrive. ${words(8)}.`,
        source: '<example-publisher>, 9 May 2031',
      },
    ],
  });
}

const PAUSES = { beatGapSec: 0, landingSec: 0 };

function ctx(patch: Partial<ScriptCheckContext> = {}): ScriptCheckContext {
  return {
    plan: plan(),
    notes: notes(),
    topicTitle: 'Queues',
    level: 'beginner',
    wordsPerSec: 2.7,
    pauses: PAUSES,
    ...patch,
  };
}

function codes(out: ScriptwriterOutput, context = ctx()) {
  return scriptProblems(out, context).map((p) => `${p.code} ${p.path}`);
}

describe('wordBudgets', () => {
  it('is target seconds less pauses, times words per second, ±15%', () => {
    expect(wordBudgets(plan(), 2.7, PAUSES)[0]).toEqual({
      beatId: 'b1',
      targetSec: 10,
      narrationSec: 10,
      words: 27,
      min: 23,
      max: 31,
    });
  });

  it('takes the landing hold from every beat and the gap from all but the last', () => {
    const budgets = wordBudgets(plan(), 2, { beatGapSec: 1, landingSec: 0.5 });
    expect(budgets.map((b) => b.narrationSec)).toEqual([8.5, 8.5, 4.5]);
  });

  it('ends each part without a gap', () => {
    const p = plan();
    p.parts = [
      { part: 1, title: 'One', mainIdea: 'One.', beatIds: ['b1'], targetLengthSec: 10 },
      { part: 2, title: 'Two', mainIdea: 'Two.', beatIds: ['b2', 'b3'], targetLengthSec: 15 },
    ];
    const budgets = wordBudgets(p, 2, { beatGapSec: 1, landingSec: 0 });
    expect(budgets.map((b) => b.narrationSec)).toEqual([10, 9, 5]);
  });
});

describe('scriptProblems', () => {
  it('passes a script that keeps every rule', () => {
    expect(scriptProblems(output(), ctx())).toEqual([]);
  });

  it('flags narration over or under its budget, with the range and the count', () => {
    const out = output();
    out.script[0]!.narration += ` ${words(5)}.`;
    out.script[2]!.narration = 'Then two million requests arrive.';
    const problems = scriptProblems(out, ctx());
    expect(problems.map((p) => p.code)).toEqual([
      'narration_over_budget',
      'narration_under_budget',
    ]);
    expect(problems[0]!.message).toContain('32 words; its budget is 23-31');
  });

  it('flags a sentence over 20 words', () => {
    const out = output();
    out.script[1]!.narration =
      'The waiting requests form a backlog and each waits two point five milliseconds while ' +
      `${words(10)}.`;
    expect(codes(out)).toEqual(['sentence_too_long $.script[1].narration']);
  });

  it('allows one number per sentence at the beginner level only', () => {
    const out = output();
    out.script[2]!.narration = `Two million requests, then five hundred more. ${words(6)}.`;
    expect(codes(out)).toEqual(['numbers_per_sentence $.script[2].narration']);
    expect(codes(out, ctx({ level: 'intermediate' }))).toEqual([]);
  });

  it('does not count everyday one, two and three as numbers', () => {
    const out = output();
    out.script[2]!.narration = `One queue, two workers, three steps. ${words(7)}.`;
    expect(codes(out)).toEqual([]);
  });

  it('flags numbers that are not research values, spoken or written, in every text', () => {
    const out = output();
    out.script[1]!.narration = out.script[1]!.narration.replace('a line of work', 'forty deep');
    out.script[1]!.headline = { text: 'Backlog = 40% of work', semantic: 'concept' };
    out.script[1]!.tags = ['1,000 WAITING'];
    expect(codes(out)).toEqual([
      'number_not_in_notes $.script[1].narration',
      'number_not_in_notes $.script[1].headline.text',
      'number_not_in_notes $.script[1].tags[0]',
    ]);
  });

  it('matches research values by value, dates included, and skips identifiers', () => {
    const out = output();
    out.script[2]!.narration = `On the ninth, p ninety-nine hit two point five. ${words(5)}.`;
    out.script[2]!.headline = { text: '2M requests, 9 May 2031', semantic: 'problem' };
    expect(codes(out)).toEqual([]);
  });

  it('requires stat cards to cite a research number and show its value', () => {
    const out = output();
    out.script[1]!.statCards = [
      { value: '2.5 ms', label: 'wait', sourceRef: 'num-9' },
      { value: '25 ms', label: 'wait', sourceRef: 'num-2' },
    ];
    expect(codes(out)).toEqual([
      'stat_cards_per_beat $.script[1].statCards',
      'stat_card_not_a_number $.script[1].statCards[0].sourceRef',
      'stat_card_value_mismatch $.script[1].statCards[1].value',
    ]);
  });

  it('requires the hook to say its numbers', () => {
    const out = output();
    out.script[0]!.narration = `A burst of requests hits one queue. ${words(10)}. ${words(10)}.`;
    expect(codes(out)).toEqual(['hook_number_missing $.script[0].narration']);
  });

  it('requires each new term in its beat and never before it', () => {
    const out = output();
    out.script[0]!.narration = out.script[0]!.narration.replace(
      'one queue',
      'one queue as a backlog',
    );
    out.script[1]!.narration = out.script[1]!.narration.replace('a backlog', 'a pile');
    expect(codes(out)).toEqual([
      'new_term_missing $.script[1].narration',
      'new_term_too_early $.script[0].narration',
    ]);
  });

  it('requires each stat card’s number to be said in its beat', () => {
    const out = output();
    out.script[1]!.narration = out.script[1]!.narration.replace('two point five', 'a few');
    expect(codes(out)).toEqual(['stat_card_not_spoken $.script[1].statCards[0]']);
  });

  it('allows at most four stat cards per video, reported once at the first card over', () => {
    const out = output();
    const card = (sourceRef: string, value: string) => ({ value, label: 'x', sourceRef });
    out.script[0]!.statCards = [card('num-1', '500'), card('num-1', '500')];
    out.script[1]!.statCards = [card('num-2', '2.5 ms'), card('num-2', '2.5 ms')];
    out.script[2]!.statCards = [card('num-3', '2 million')];
    out.script[0]!.source = '<example-publisher> field guide';
    expect(codes(out).filter((c) => c.startsWith('stat_cards'))).toEqual([
      'stat_cards_per_beat $.script[0].statCards',
      'stat_cards_per_beat $.script[1].statCards',
      'stat_cards_per_video $.script[2].statCards[0]',
    ]);
  });

  it('flags a tag that repeats its beat’s stat card number', () => {
    const out = output();
    out.script[1]!.tags = ['WAIT 2.5 MS', 'BACKLOG'];
    expect(codes(out)).toEqual(['tag_repeats_stat_card $.script[1].tags[0]']);
  });

  it('requires a concept headline "term = meaning" on a beat that introduces a term', () => {
    const cases = [
      undefined,
      { text: 'Backlog = work waiting its turn', semantic: 'problem' as const },
      { text: 'Backlogs grow fast', semantic: 'concept' as const },
      { text: 'Queue = work waiting', semantic: 'concept' as const },
    ];
    for (const headline of cases) {
      const out = output();
      if (headline) out.script[1]!.headline = headline;
      else delete out.script[1]!.headline;
      expect(codes(out)).toEqual(['headline_not_concept $.script[1].headline']);
    }
    const out = output();
    out.script[1]!.headline = { text: 'Backlogs = requests in line', semantic: 'concept' };
    expect(codes(out)).toEqual([]);
  });

  describe('headline_repeated', () => {
    /** Codes when b1 and b3 carry these headlines (b2 keeps its concept headline). */
    const repeated = (first: string, third: string) => {
      const out = output();
      out.script[0]!.headline = { text: first, semantic: 'problem' };
      out.script[2]!.headline = { text: third, semantic: 'problem' };
      return codes(out);
    };
    const FIRES = ['headline_repeated $.script[2].headline.text'];

    it('flags longer headlines sharing more than half the shorter one’s content words', () => {
      expect(
        repeated('Bursts fill the shared queue fast', 'A flood of bursts fills every shared queue'),
      ).toEqual(FIRES);
      expect(repeated('Bursts fill the shared queue fast', 'Floods need the network edge')).toEqual(
        [],
      );
    });

    it('flags two headlines that differ only in word order', () => {
      expect(repeated('Fail open multiplies the limit', 'The limit multiplies, fail open')).toEqual(
        FIRES,
      );
      expect(repeated('Shared store wins', 'Wins: shared store')).toEqual(FIRES);
    });

    it('flags short headlines (3 or fewer content words) only when the words are the same', () => {
      expect(repeated("'the' = one token", 'token = one text piece, one id')).toEqual([]);
      expect(repeated('Shared store wins', 'Shared store fails')).toEqual([]);
    });

    it('ignores stopwords, number words, digits and quoted example words', () => {
      expect([...headlineWords("'the' = one token")]).toEqual(['token']);
      expect([...headlineWords('Two hundred tokens in 2.5 ms')]).toEqual(['token', 'ms']);
      expect(repeated('500 requests wait', 'Two million requests wait')).toEqual(FIRES);
      expect([...headlineWords("The model's own tokenizer")]).toEqual([
        'model',
        'own',
        'tokenizer',
      ]);
    });
  });

  it('requires the main term in the first two beats at the beginner level', () => {
    const out = output();
    out.script[0]!.narration = out.script[0]!.narration.replace('one queue', 'one server');
    expect(codes(out)).toEqual(['topic_not_defined $.script[0].narration']);
    expect(codes(out, ctx({ level: 'intermediate' }))).toEqual([]);
    out.script[1]!.narration = out.script[1]!.narration.replace(
      'The waiting requests',
      'The requests in the queue',
    );
    expect(codes(out)).toEqual([]);
  });

  it('leaves the main term to the plan when a later beat introduces it', () => {
    const p = plan();
    p.story.beats[2]!.newTerms = ['flood'];
    const out = output();
    out.script[2]!.narration = `Then two million requests flood in. ${words(7)}.`;
    out.script[2]!.headline = { text: 'Flood = more than the queue holds', semantic: 'concept' };
    expect(codes(out, ctx({ plan: p, topicTitle: 'flood' }))).toEqual([]);
    expect(codes(out, ctx({ topicTitle: 'flood' }))).toEqual([
      'topic_not_defined $.script[0].narration',
    ]);
  });

  it('allows at most two distinct numbers per beat at the beginner level, dates aside', () => {
    const out = output();
    out.script[0]!.narration =
      'A burst of five hundred requests hits one queue. Each waits two point five ' +
      `milliseconds. Then two million arrive. ${words(8)}.`;
    expect(codes(out)).toEqual(['numbers_per_beat $.script[0].narration']);
    expect(codes(out, ctx({ level: 'intermediate' }))).toEqual([]);
    out.script[0]!.narration =
      'A burst of five hundred requests hits one queue. On nine May twenty thirty-one, ' +
      `two million arrived. ${words(9)}.`;
    expect(codes(out)).toEqual([]);
  });

  it('flags a bare source line, and lets a bare planned line be replaced', () => {
    const out = output();
    out.script[1]!.source = 'quotaflow';
    expect(codes(out)).toEqual(['source_label_bare $.script[1].source']);
    const p = plan();
    p.story.beats[2]!.source = 'acme.com';
    const fixed = output();
    fixed.script[2]!.source = 'Acme engineering blog, 9 May 2031';
    expect(codes(fixed, ctx({ plan: p, sourceNames: ['acme.com', 'acme'] }))).toEqual([]);
    fixed.script[2]!.source = 'acme.com';
    expect(codes(fixed, ctx({ plan: p, sourceNames: ['acme.com', 'acme'] }))).toEqual([
      'source_label_bare $.script[2].source',
    ]);
  });

  it('keeps a planned source line word for word', () => {
    const out = output();
    out.script[2]!.source = '<example-publisher> report';
    expect(codes(out)).toEqual(['source_changed $.script[2].source']);
  });

  it('requires a source on planned-source beats and on beats with stat cards', () => {
    const out = output();
    delete out.script[1]!.source;
    delete out.script[2]!.source;
    expect(codes(out)).toEqual([
      'source_missing $.script[1].source',
      'source_missing $.script[2].source',
    ]);
  });
});

describe('helpers', () => {
  it('splits sentences at end punctuation, not inside decimals', () => {
    expect(sentences('It took 2.5 ms. Then? It stopped! Done…  Ok')).toEqual([
      'It took 2.5 ms.',
      'Then?',
      'It stopped!',
      'Done…',
      'Ok',
    ]);
  });
});
