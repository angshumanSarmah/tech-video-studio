import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VideoSettingsSchema, type VideoSettings } from '../config/video.ts';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import {
  MAX_BEATS_PER_PATTERN,
  MAX_BEATS_PER_SCENE,
  MAX_HOOK_NUMBERS,
  MAX_SCENES_PER_LAYOUT_MODE,
} from '../spec/story.ts';
import { validateVideoSpec } from '../spec/validate.ts';
import {
  directorPlanProblems,
  isAdvisoryPlanCode,
  MAX_BEATS_PER_DEVICE,
  MAX_RECENT_COMBO_REUSE,
  MIN_PAYOFF_GAP_BEATS,
  type DirectorCheckContext,
} from './checks.ts';
import { partPlan } from './part-plan.ts';
import { DirectorPlanSchema, type DirectorPlan } from './plan.ts';
import { specFromPlan } from './spec.ts';

const C = ['source-1#chunk-1'];

/** Invented notes: two facts, two numbers, a glossary of four terms and one incident. */
function notes(patch: Partial<ResearchNotes> = {}): ResearchNotes {
  return ResearchNotesSchema.parse({
    mechanism: {
      summary: 'A queue drains at a fixed rate.',
      sourceChunkIds: C,
      steps: [{ text: 'Requests wait.', sourceChunkIds: C }],
    },
    plainSummary: 'Requests wait their turn.',
    analogies: [{ analogy: 'A ticket line.', matches: 'Order.', breaksDown: 'No tickets.' }],
    glossary: ['Queue', 'Drain rate', 'Backlog', 'Shedding'].map((term) => ({
      term,
      plainMeaning: `What ${term} means.`,
      sourceChunkIds: C,
    })),
    facts: [
      { id: 'fact-1', statement: 'A queue absorbs bursts.', sourceChunkIds: C, confidence: 'high' },
      {
        id: 'fact-2',
        statement: 'A full queue sheds load.',
        sourceChunkIds: C,
        confidence: 'high',
      },
    ],
    numbers: [
      { id: 'num-1', value: '500', unit: 'requests', context: 'burst', sourceChunkId: C[0] },
      { id: 'num-2', value: '20', unit: 'ms', context: 'wait', sourceChunkId: C[0] },
    ],
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [
      {
        kind: 'incident',
        description: 'An outage.',
        incident: { date: '<example-date>' },
        sourceChunkIds: C,
      },
    ],
    hooks: [
      { situation: 'A burst of 500 requests.', sourceChunkIds: C },
      { situation: 'Each waits 20 ms.', sourceChunkIds: C },
    ],
    openQuestions: [],
    ...patch,
  });
}

/** A valid single-video plan: 60 s, five beats. */
function plan(): DirectorPlan {
  return DirectorPlanSchema.parse({
    meta: {
      title: 'Why queues shed load',
      topicClass: 'concept',
      format: 'full',
      targetLengthSec: 60,
    },
    story: {
      devices: ['failure_before_fix'],
      runningExample: 'One checkout request waits behind a burst.',
      chapters: [
        { id: 'burst', title: 'The burst' },
        { id: 'fix', title: 'The fix' },
      ],
      beats: [
        {
          id: 'hook',
          chapterId: 'burst',
          intent: 'A burst hits',
          device: 'contention_hook',
          targetSec: 10,
          hookNumberIds: ['num-1'],
          layoutMode: 'centered_focus',
        },
        {
          id: 'break',
          chapterId: 'burst',
          intent: 'The server falls over',
          device: 'failure_before_fix',
          targetSec: 12,
          factIds: ['fact-1'],
          newTerms: ['queue'],
        },
        {
          id: 'queue',
          chapterId: 'fix',
          intent: 'Requests wait',
          targetSec: 14,
          factIds: ['num-2'],
          newTerms: ['Backlog'],
        },
        {
          id: 'shed',
          chapterId: 'fix',
          intent: 'A full queue sheds',
          targetSec: 12,
          factIds: ['fact-2'],
        },
        {
          id: 'end',
          chapterId: 'fix',
          intent: 'Spec card',
          device: 'spec_card_ending',
          targetSec: 12,
        },
      ],
      plantedQuestion: { text: 'What breaks first?', beatId: 'hook', payoffBeatId: 'shed' },
      ending: {
        kind: 'spec_card_ending',
        cta: '<example-share-line>',
        specCard: { lines: ['<example-line-1>', '<example-line-2>', '<example-line-3>'] },
      },
    },
  });
}

const video = (patch: Partial<VideoSettings> = {}) => VideoSettingsSchema.parse(patch);

function ctx(patch: Partial<DirectorCheckContext> = {}): DirectorCheckContext {
  return {
    notes: notes(),
    video: video(),
    recentCombos: [],
    series: { name: 'System Design', label: 'SYSTEM DESIGN' },
    ...patch,
  };
}

function problemsAfter(mutate: (p: DirectorPlan) => void, context = ctx()) {
  const p = plan();
  mutate(p);
  return directorPlanProblems(p, context).map((x) => [x.path, x.code]);
}

/**
 * Splits the plan into two parts of 45 s: part 1 ends on a cliffhanger, part 2 opens with a
 * recap (no number needed) and its hook ("shed") cites one.
 */
function twoParts(p: DirectorPlan): void {
  delete p.meta.targetLengthSec;
  const [hook, brk, queue, shed, end] = p.story.beats;
  hook!.targetSec = 20;
  brk!.device = 'cliffhanger_ending';
  brk!.targetSec = 25;
  queue!.device = 'recap_opening';
  queue!.factIds = ['fact-1'];
  queue!.targetSec = 15;
  shed!.factIds = ['fact-2'];
  shed!.hookNumberIds = ['num-2'];
  shed!.device = 'failure_before_fix';
  shed!.targetSec = 15;
  end!.targetSec = 15;
  p.story.devices = ['failure_before_fix'];
  p.story.plantedQuestion = { text: 'What breaks?', beatId: 'queue', payoffBeatId: 'end' };
  p.parts = [
    {
      part: 1,
      title: 'The burst',
      mainIdea: 'Bursts break servers.',
      beatIds: ['hook', 'break'],
      targetLengthSec: 45,
    },
    {
      part: 2,
      title: 'The fix',
      mainIdea: 'Queues absorb bursts.',
      beatIds: ['queue', 'shed', 'end'],
      targetLengthSec: 45,
    },
  ];
  // Chapters stay inside one part each.
}

describe('directorPlanProblems', () => {
  it('needs every device in story.devices on at least one beat', () => {
    expect(problemsAfter((p) => p.story.devices.push('roadmap', 'contention_hook'))).toEqual([
      ['$.story.devices[1]', 'devices_unused'],
    ]);
  });

  it('passes a valid plan, which is also a valid spec', () => {
    expect(directorPlanProblems(plan(), ctx())).toEqual([]);
    const result = validateVideoSpec(
      specFromPlan(plan(), { id: 'queues', series: 'system-design' }),
    );
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it('reports research ids that are not in the notes', () => {
    expect(problemsAfter((p) => p.story.beats[1]!.factIds.push('fact-9', 'num-7'))).toEqual([
      ['$.story.beats[1].factIds[1]', 'unknown_fact'],
      ['$.story.beats[1].factIds[2]', 'unknown_fact'],
    ]);
  });

  it('caps the facts one beat cites at the beginner level, numbers aside', () => {
    const facts = [1, 2, 3, 4].map((n) => ({
      id: `fact-${n}`,
      statement: `Fact ${n}.`,
      sourceChunkIds: C,
      confidence: 'high' as const,
    }));
    const context = (level: VideoSettings['explanationLevel']) =>
      ctx({ notes: notes({ facts }), video: { ...video(), explanationLevel: level } });
    const cite = (ids: string[]) => (p: DirectorPlan) => (p.story.beats[1]!.factIds = ids);
    const three = cite(['fact-1', 'fact-2', 'fact-3', 'num-1', 'num-2']);
    const four = cite(['fact-1', 'fact-2', 'fact-3', 'fact-4']);
    expect(problemsAfter(three, context('beginner'))).toEqual([]);
    expect(problemsAfter(four, context('beginner'))).toEqual([
      ['$.story.beats[1].factIds', 'too_many_facts_in_beat'],
    ]);
    expect(problemsAfter(four, context('intermediate'))).toEqual([]);
  });

  it('caps the research numbers one beat uses at the beginner level, hook numbers included', () => {
    const numbers = [1, 2, 3].map((n) => ({
      id: `num-${n}`,
      value: String(n * 100),
      unit: 'requests',
      context: 'load',
      sourceChunkId: C[0]!,
    }));
    const context = (level: VideoSettings['explanationLevel']) =>
      ctx({ notes: notes({ numbers }), video: { ...video(), explanationLevel: level } });
    const three = (p: DirectorPlan) => p.story.beats[1]!.factIds.push('num-1', 'num-2', 'num-3');
    const twice = (p: DirectorPlan) => p.story.beats[1]!.factIds.push('num-1', 'num-2', 'num-1');
    expect(problemsAfter(twice, context('beginner'))).toEqual([]);
    expect(problemsAfter(three, context('beginner'))).toEqual([
      ['$.story.beats[1].factIds', 'too_many_numbers_in_beat'],
    ]);
    expect(problemsAfter(three, context('expert'))).toEqual([]);
  });

  describe('one system per story', () => {
    /** Source 1 is the incident's report, source 2 a guide; num-2 comes from the guide. */
    const twoSources = () =>
      ctx({
        notes: notes({
          numbers: [
            {
              id: 'num-1',
              value: '500',
              unit: 'requests',
              context: 'burst',
              sourceChunkId: 'source-1#chunk-1',
            },
            {
              id: 'num-2',
              value: '20',
              unit: 'ms',
              context: 'wait',
              sourceChunkId: 'source-2#chunk-1',
            },
          ],
        }),
        sources: [
          { sourceId: 1, title: '<example-publisher> outage report', origin: 'report.md' },
          { sourceId: 2, title: '<example-guide> to queues', origin: 'guide.md' },
        ],
      });
    const incident = (p: DirectorPlan) => {
      p.story.beats[3]!.device = 'real_incident';
      p.story.beats[3]!.factIds = ['fact-1'];
      p.story.beats[3]!.source = '<example-publisher> outage report';
    };
    const mixed = (mutate: (p: DirectorPlan) => void, context = twoSources()) =>
      problemsAfter((p) => {
        incident(p);
        mutate(p);
      }, context).filter(([, code]) => code === 'mixed_system_numbers');

    it('flags a beat citing numbers from a source the incident does not cite', () => {
      expect(mixed(() => {})).toEqual([['$.story.beats[2].factIds', 'mixed_system_numbers']]);
      const p = plan();
      incident(p);
      const found = directorPlanProblems(p, twoSources()).find(
        (x) => x.code === 'mixed_system_numbers',
      );
      expect(found?.message).toBe(
        'Beat "queue" cites num-2: these numbers come from "<example-guide> to queues", not the ' +
          "incident: set exampleNumbers and label them as an example, or use the incident's " +
          'numbers.',
      );
    });

    it('accepts them when the beat sets exampleNumbers, and without an incident', () => {
      expect(mixed((p) => (p.story.beats[2]!.exampleNumbers = true))).toEqual([]);
      expect(
        problemsAfter(() => {}, twoSources()).filter(([, code]) => code === 'mixed_system_numbers'),
      ).toEqual([]);
    });

    it('takes the incident’s sources from every number and fact its beats cite', () => {
      // The incident beat also cites num-2: the guide becomes one of its sources.
      expect(mixed((p) => p.story.beats[3]!.factIds.push('num-2'))).toEqual([]);
    });
  });

  it('counts a number whose value lists several values once, in ids and in the intent', () => {
    const numbers = [
      {
        id: 'num-1',
        value: '40, 80 and 150',
        unit: 'ms',
        context: 'latencies',
        sourceChunkId: C[0]!,
      },
      { id: 'num-2', value: '500', unit: 'requests', context: 'burst', sourceChunkId: C[0]! },
    ];
    const context = ctx({ notes: notes({ numbers }) });
    const beat = (intent: string, ids: string[]) => (p: DirectorPlan) => {
      p.story.beats[1]!.intent = intent;
      p.story.beats[1]!.factIds = ids;
    };
    // One multi-value number plus one more: two numbers, not four.
    expect(
      problemsAfter(
        beat('Calls take 40, 80 and 150 ms under 500 requests', ['num-1', 'num-2']),
        context,
      ),
    ).toEqual([]);
    // The same number stated in the intent without citing it still counts once.
    expect(problemsAfter(beat('Calls take 40, 80 and 150 ms', []), context)).toEqual([]);
    // A puzzle hook may cite it as its one number.
    const puzzle = (p: DirectorPlan) => {
      p.story.hook = { kind: 'puzzle' };
      p.story.beats[0]!.intent = 'Why do calls take 40, 80 and then 150 ms?';
      p.story.beats[0]!.hookNumberIds = ['num-1'];
    };
    expect(problemsAfter(puzzle, context)).toEqual([]);
  });

  it('counts the research numbers a beat’s intent states, by value, dates aside', () => {
    const numbers = [1, 2, 3].map((n) => ({
      id: `num-${n}`,
      value: String(n * 100),
      unit: 'requests',
      context: 'load',
      sourceChunkId: C[0]!,
      asOf: '9 May 2031',
    }));
    const context = ctx({ notes: notes({ numbers }) });
    const intent = (text: string, ids: string[]) => (p: DirectorPlan) => {
      p.story.beats[1]!.intent = text;
      p.story.beats[1]!.factIds = ids;
    };
    const stated = intent('On 9 May 2031 one queue took 100 requests, then two hundred.', [
      'num-1',
    ]);
    expect(problemsAfter(stated, context)).toEqual([]);
    const extra = intent('A queue took 100, then 200, then 300 requests.', ['num-1']);
    expect(problemsAfter(extra, context)).toEqual([
      ['$.story.beats[1].factIds', 'too_many_numbers_in_beat'],
    ]);
  });

  describe('clarity', () => {
    it('matches new terms against the glossary, ignoring case', () => {
      expect(problemsAfter((p) => (p.story.beats[3]!.newTerms = ['DRAIN  rate']))).toEqual([]);
      expect(problemsAfter((p) => (p.story.beats[3]!.newTerms = ['token bucket']))).toEqual([
        ['$.story.beats[3].newTerms[0]', 'unknown_term'],
      ]);
    });

    it('allows one new term per beat', () => {
      expect(
        problemsAfter((p) => {
          p.story.beats[2]!.newTerms = [];
          p.story.beats[3]!.newTerms = ['Shedding', 'Drain rate'];
        }),
      ).toEqual([['$.story.beats[3].newTerms', 'too_many_new_terms_in_beat']]);
    });

    it('caps distinct new terms by explanation level', () => {
      const four = (p: DirectorPlan) => {
        p.story.beats[3]!.newTerms = ['Shedding'];
        p.story.beats[4]!.newTerms = ['Drain rate'];
        p.story.beats[0]!.newTerms = ['QUEUE']; // a repeat counts once
      };
      expect(problemsAfter(four)).toEqual([['$.story.beats', 'too_many_new_terms']]);
      const p = plan();
      four(p);
      const message = directorPlanProblems(p, ctx()).find((x) => x.code === 'too_many_new_terms');
      expect(message?.message).toBe(
        'The beats introduce 4 distinct terms (hook: "QUEUE"; break: "queue"; queue: ' +
          '"Backlog"; shed: "Shedding"; end: "Drain rate"); at the beginner level the ' +
          'video introduces at most 3: keep the 3 the story depends on; describe the others in ' +
          'plain words without naming them (e.g. "the limiter let everything through").',
      );
      expect(
        problemsAfter(four, ctx({ video: video({ explanationLevel: 'intermediate' }) })),
      ).toEqual([]);
    });

    it('needs a running example at beginner only', () => {
      const drop = (p: DirectorPlan) => delete p.story.runningExample;
      expect(problemsAfter(drop)).toEqual([['$.story.runningExample', 'running_example_missing']]);
      expect(problemsAfter(drop, ctx({ video: video({ explanationLevel: 'expert' }) }))).toEqual(
        [],
      );
    });
  });

  describe('length', () => {
    it('sums beat seconds to the target within 10%', () => {
      expect(problemsAfter((p) => (p.story.beats[0]!.targetSec = 15))).toEqual([]); // 65 s
      expect(problemsAfter((p) => (p.story.beats[0]!.targetSec = 17))).toEqual([
        ['$.story.beats', 'target_length_mismatch'],
      ]);
    });

    it('keeps the target in the configured range, or on the run override', () => {
      expect(
        problemsAfter(
          () => {},
          ctx({ video: video({ lengthMinSec: 70, lengthReasonAboveSec: 90 }) }),
        ),
      ).toEqual([['$.meta.targetLengthSec', 'target_length_out_of_range']]);
      expect(problemsAfter(() => {}, ctx({ lengthOverrideSec: 75 }))).toEqual([
        ['$.meta.targetLengthSec', 'target_length_override'],
      ]);
      expect(problemsAfter((p) => delete p.meta.targetLengthSec)).toEqual([
        ['$.meta.targetLengthSec', 'target_length_missing'],
      ]);
    });

    it('needs a reason above the threshold', () => {
      const long = (p: DirectorPlan) => {
        p.meta.targetLengthSec = 100;
        p.story.beats[4]!.targetSec = 52;
      };
      expect(problemsAfter(long)).toEqual([['$.lengthReason', 'length_reason_missing']]);
      expect(
        problemsAfter((p) => {
          long(p);
          p.lengthReason = '<example-reason>';
        }),
      ).toEqual([]);
    });
  });

  describe('parts', () => {
    it('accepts contiguous parts with a recap and a cliffhanger', () => {
      expect(problemsAfter(twoParts)).toEqual([]);
    });

    it('checks each part’s length on its own', () => {
      expect(
        problemsAfter((p) => {
          twoParts(p);
          p.parts![1]!.targetLengthSec = 40;
        }),
      ).toEqual([
        ['$.parts[1].targetLengthSec', 'target_length_out_of_range'],
        ['$.parts[1].beatIds', 'target_length_mismatch'],
      ]);
    });

    it('respects the parts settings', () => {
      expect(problemsAfter(twoParts, ctx({ video: video({ allowParts: false }) }))).toEqual([
        ['$.parts', 'parts_not_allowed'],
      ]);
    });

    it('needs every beat once, in order, numbered parts', () => {
      expect(
        problemsAfter((p) => {
          twoParts(p);
          p.parts![1]!.beatIds = ['shed', 'queue', 'end', 'ghost'];
          p.parts![1]!.part = 3;
        }),
      ).toEqual([
        ['$.parts[1].part', 'part_order'],
        ['$.parts[1].beatIds[3]', 'unknown_beat'],
        ['$.parts', 'parts_cover_beats'],
        // Part 2 now opens on "shed", which is no recap.
        ['$.story.beats[3].device', 'recap_missing'],
      ]);
    });

    it('keeps chapters, questions and alternatives inside one part', () => {
      expect(
        problemsAfter((p) => {
          twoParts(p);
          p.story.beats[2]!.chapterId = 'burst';
          p.story.plantedQuestion!.beatId = 'hook';
          p.story.rejectedAlternative = { beatId: 'break', summary: 'x', chosenBeatId: 'shed' };
        }),
      ).toEqual([
        ['$.story.chapters[0]', 'chapter_spans_parts'],
        ['$.story.plantedQuestion.payoffBeatId', 'payoff_in_other_part'],
        ['$.story.rejectedAlternative.chosenBeatId', 'chosen_in_other_part'],
      ]);
    });

    it('ends earlier parts on a cliffhanger and opens later parts with a recap', () => {
      expect(
        problemsAfter((p) => {
          twoParts(p);
          p.story.beats[1]!.device = undefined;
          p.story.beats[2]!.device = 'roadmap';
          p.story.beats[2]!.hookNumberIds = ['num-1'];
          delete p.story.beats[3]!.hookNumberIds;
        }),
      ).toEqual([
        ['$.story.beats[1].device', 'cliffhanger_missing'],
        ['$.story.beats[2].device', 'recap_missing'],
      ]);
    });

    describe('a part run’s plan (part context)', () => {
      const split = () => {
        const p = plan();
        twoParts(p);
        return p;
      };
      const codes = (p: DirectorPlan, part?: { index: number; count: number }) =>
        directorPlanProblems(p, ctx(part ? { part } : {})).map((x) => [x.path, x.code]);

      it('checks each part as that part of the video: no problems', () => {
        expect(codes(partPlan(split(), 1), { index: 1, count: 2 })).toEqual([]);
        expect(codes(partPlan(split(), 2), { index: 2, count: 2 })).toEqual([]);
      });

      it('without it, part 1 is a whole video that never closes', () => {
        expect(codes(partPlan(split(), 1))).toEqual([
          ['$.story', 'no_failure_or_alternative'],
          ['$.story.ending.kind', 'ending_kind'],
        ]);
      });

      it('still needs the part’s own cliffhanger and recap', () => {
        const first = partPlan(split(), 1);
        first.story.beats[1]!.device = undefined;
        const second = partPlan(split(), 2);
        second.story.beats[0]!.device = undefined;
        second.story.devices = ['failure_before_fix'];
        expect(codes(first, { index: 1, count: 2 })).toEqual([
          ['$.story.beats[1].device', 'cliffhanger_missing'],
        ]);
        // Without its recap, the part's first beat is its hook, too.
        expect(codes(second, { index: 2, count: 2 })).toContainEqual([
          '$.story.beats[0].device',
          'recap_missing',
        ]);
      });

      it('closes the topic only in the last part', () => {
        const last = partPlan(split(), 2);
        last.story.ending = { kind: 'cliffhanger_ending' };
        expect(codes(last, { index: 2, count: 2 })).toEqual([
          ['$.story.ending.kind', 'ending_kind'],
        ]);
      });
    });
  });

  describe('devices', () => {
    it('needs what planted_question, hero_metric and question_chapters use', () => {
      expect(
        problemsAfter((p) => {
          delete p.story.plantedQuestion;
          p.story.beats[0]!.device = 'question_chapters';
          p.story.beats[2]!.device = 'planted_question';
          p.story.beats[3]!.device = 'hero_metric';
          p.story.chapters[0]!.question = 'Why did it fall over?';
        }),
      ).toEqual([
        ['$.story.plantedQuestion', 'planted_question_missing'],
        ['$.story.heroMetric', 'hero_metric_missing'],
        ['$.story.chapters[1].question', 'chapter_question_missing'],
      ]);
    });

    it('needs a source and facts on a real-incident beat, and an incident in the notes', () => {
      const incident = (p: DirectorPlan) => {
        p.story.beats[3]!.device = 'real_incident';
        p.story.beats[3]!.factIds = [];
      };
      expect(problemsAfter(incident)).toEqual([
        ['$.story.beats[3].source', 'incident_source_missing'],
        ['$.story.beats[3].factIds', 'incident_without_facts'],
      ]);
      expect(
        problemsAfter(
          (p) => {
            incident(p);
            p.story.beats[3]!.factIds = ['fact-2'];
            p.story.beats[3]!.source = '<example-publisher> post-incident report';
          },
          ctx({ notes: notes({ failureModes: [] }) }),
        ),
      ).toEqual([['$.story.beats[3].device', 'incident_not_in_notes']]);
    });

    it('takes a failure before the fix or a rejected alternative', () => {
      const noFailure = (p: DirectorPlan) => {
        p.story.devices = [];
        p.story.beats[1]!.device = 'what_breaks';
      };
      expect(problemsAfter(noFailure)).toEqual([['$.story', 'no_failure_or_alternative']]);
      expect(
        problemsAfter((p) => {
          noFailure(p);
          p.story.rejectedAlternative = { beatId: 'break', summary: 'x', chosenBeatId: 'queue' };
        }),
      ).toEqual([]);
      expect(
        problemsAfter((p) => {
          noFailure(p);
          p.story.rejectedAlternative = { beatId: 'break', summary: 'x' };
        }),
      ).toEqual([['$.story.rejectedAlternative.chosenBeatId', 'chosen_design_missing']]);
    });
  });

  describe('hook', () => {
    it('is a problem hook when a plan (an old recording) has no hook field', () => {
      expect(plan().story.hook).toEqual({ kind: 'problem' });
      const p = plan() as { story: { hook?: unknown } };
      delete p.story.hook;
      expect(DirectorPlanSchema.parse(p).story.hook).toEqual({ kind: 'problem' });
      expect(
        DirectorPlanSchema.parse({ ...plan(), story: { ...plan().story, hook: {} } }).story.hook,
      ).toEqual({ kind: 'problem' });
    });

    it('puzzle: a question with at most one research number, none required', () => {
      const puzzle = (intent: string, ids?: string[]) => (p: DirectorPlan) => {
        p.story.hook = { kind: 'puzzle' };
        p.story.beats[0]!.intent = intent;
        if (ids) p.story.beats[0]!.hookNumberIds = ids;
        else delete p.story.beats[0]!.hookNumberIds;
      };
      expect(problemsAfter(puzzle('Why does a burst not fail every request?'))).toEqual([]);
      expect(problemsAfter(puzzle('Why do 500 requests not break it?', ['num-1']))).toEqual([]);
      expect(problemsAfter(puzzle('A burst hits', ['num-1']))).toEqual([
        ['$.story.beats[0].intent', 'hook_not_question'],
      ]);
      // A number the intent states counts with the ids, as for every beat.
      expect(
        problemsAfter(puzzle('Why do 500 requests stall when each waits 20 ms?', ['num-1'])),
      ).toEqual([['$.story.beats[0].hookNumberIds', 'hook_too_many_numbers']]);
      expect(problemsAfter(puzzle('Why do 500 requests stall?', ['num-1', 'num-2']))).toEqual([
        ['$.story.beats[0].hookNumberIds', 'hook_too_many_numbers'],
      ]);
    });

    it('problem: one or two research numbers, whatever the topic class', () => {
      const problemHook = (topicClass: DirectorPlan['meta']['topicClass']) => (p: DirectorPlan) => {
        p.meta.topicClass = topicClass;
        p.story.hook = { kind: 'problem' };
        delete p.story.beats[0]!.hookNumberIds;
      };
      expect(problemsAfter(problemHook('concept'))).toContainEqual([
        '$.story.beats[0].hookNumberIds',
        'hook_without_number',
      ]);
      // A question does not make a problem hook a puzzle: it still needs its numbers.
      expect(
        problemsAfter((p) => {
          problemHook('concept')(p);
          p.story.beats[0]!.intent = 'Why does a burst hit?';
        }),
      ).toContainEqual(['$.story.beats[0].hookNumberIds', 'hook_without_number']);
    });

    it('names one or two research numbers in hookNumberIds when the notes have any', () => {
      const drop = (p: DirectorPlan) => delete p.story.beats[0]!.hookNumberIds;
      expect(problemsAfter(drop)).toEqual([
        ['$.story.beats[0].hookNumberIds', 'hook_without_number'],
      ]);
      const withoutNumbers = problemsAfter(drop, ctx({ notes: notes({ numbers: [] }) }));
      expect(withoutNumbers.map(([, code]) => code)).not.toContain('hook_without_number');
    });

    it(`caps hookNumberIds at ${MAX_HOOK_NUMBERS} in the schema itself`, () => {
      const p = plan();
      p.story.beats[0]!.hookNumberIds = ['num-1', 'num-2', 'num-1'];
      const parsed = DirectorPlanSchema.safeParse(p);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(['story', 'beats', 0, 'hookNumberIds']);
      const schema = JSON.stringify(z.toJSONSchema(DirectorPlanSchema, { io: 'input' }));
      expect(schema).toContain(`"maxItems":${MAX_HOOK_NUMBERS}`);
    });

    it('keeps the hook’s numbers out of its factIds, and hookNumberIds on hooks only', () => {
      expect(
        problemsAfter((p) => {
          p.story.beats[0]!.factIds = ['fact-1', 'num-2', 'num-1'];
          p.story.beats[2]!.hookNumberIds = ['num-2'];
        }),
      ).toEqual([
        ['$.story.beats[0].factIds', 'hook_numbers_in_fact_ids'],
        ['$.story.beats[2].hookNumberIds', 'hook_numbers_off_hook'],
      ]);
    });

    it('is the first beat after the recap in later parts', () => {
      // Part 2's recap ("queue") cites no number; its hook ("shed") does.
      expect(problemsAfter(twoParts)).toEqual([]);
      expect(
        problemsAfter((p) => {
          twoParts(p);
          delete p.story.beats[3]!.hookNumberIds;
        }),
      ).toEqual([['$.story.beats[3].hookNumberIds', 'hook_without_number']]);
    });
  });

  describe('ending', () => {
    it('needs the spec card and a share line for spec_card_ending', () => {
      expect(
        problemsAfter((p) => {
          delete p.story.ending.specCard;
          delete p.story.ending.cta;
        }),
      ).toEqual([
        ['$.story.ending.specCard', 'spec_card_missing'],
        ['$.story.ending.cta', 'cta_missing'],
      ]);
    });

    it('applies another ending device’s own requirements', () => {
      expect(
        problemsAfter((p) => {
          p.story.ending.kind = 'callback_ending';
          delete p.story.ending.specCard;
        }),
      ).toEqual([]);
      expect(
        problemsAfter((p) => {
          p.story.ending.kind = 'real_world_closure';
          delete p.story.ending.cta;
        }),
      ).toEqual([['$.story.ending.cta', 'cta_missing']]);
    });

    it('never closes the video (or the last part) on a cliffhanger', () => {
      expect(problemsAfter((p) => (p.story.ending.kind = 'cliffhanger_ending'))).toEqual([
        ['$.story.ending.kind', 'ending_kind'],
      ]);
    });
  });

  describe('tighter story', () => {
    it(`pays the planted question off at least ${MIN_PAYOFF_GAP_BEATS} beats later`, () => {
      expect(problemsAfter((p) => (p.story.plantedQuestion!.payoffBeatId = 'queue'))).toEqual([]);
      expect(problemsAfter((p) => (p.story.plantedQuestion!.payoffBeatId = 'break'))).toEqual([
        ['$.story.plantedQuestion.payoffBeatId', 'payoff_too_soon'],
      ]);
    });

    it(`uses one device on at most ${MAX_BEATS_PER_DEVICE} beats`, () => {
      const thrice = (p: DirectorPlan) => {
        p.story.beats[2]!.device = 'failure_before_fix';
        p.story.beats[3]!.device = 'failure_before_fix';
      };
      expect(problemsAfter(thrice)).toEqual([['$.story.beats[3].device', 'device_overused']]);
    });

    it('lets every part have its own recap and cliffhanger', () => {
      const codes = problemsAfter((p) => {
        for (const i of [1, 2, 3]) p.story.beats[i]!.device = 'recap_opening';
      }).map(([, code]) => code);
      expect(codes).not.toContain('device_overused');
    });

    it('keeps digits and the series name or label out of the CTA', () => {
      expect(
        problemsAfter((p) => (p.story.ending.cta = 'System design #12: follow along')),
      ).toEqual([
        ['$.story.ending.cta', 'cta_has_number'],
        ['$.story.ending.cta', 'cta_has_series_label'],
      ]);
      expect(
        problemsAfter((p) => (p.story.ending.cta = 'Follow for the SYSTEM  DESIGN deep dives')),
      ).toEqual([['$.story.ending.cta', 'cta_has_series_label']]);
    });

    it('matches the series label as whole words, so "AI" is not found inside other words', () => {
      const ai = ctx({ series: { name: 'AI', label: 'AI' } });
      const cta = (text: string) => (p: DirectorPlan) => (p.story.ending.cta = text);
      for (const text of [
        'Send this to someone who can explain it again',
        'Email it to a teammate who loves detail',
      ]) {
        expect(problemsAfter(cta(text), ai)).toEqual([]);
      }
      expect(problemsAfter(cta('Follow for more AI explainers'), ai)).toEqual([
        ['$.story.ending.cta', 'cta_has_series_label'],
      ]);
      expect(problemsAfter(cta('Share it with anyone learning ai'), ai)).toEqual([
        ['$.story.ending.cta', 'cta_has_series_label'],
      ]);
    });

    it('flags a term used before the later beat that introduces it, in intents and on-screen text', () => {
      expect(problemsAfter((p) => (p.story.beats[0]!.intent = 'A burst fills the queue'))).toEqual([
        ['$.story.beats[0].intent', 'term_before_intro'],
      ]);
      expect(problemsAfter((p) => (p.story.beats[0]!.intent = 'Bursts fill QUEUES'))).toEqual([
        ['$.story.beats[0].intent', 'term_before_intro'],
      ]);
      // Whole words only, plain plural only; the introducing beat itself may use it.
      for (const intent of ['Requests start queueing', 'A burst hits']) {
        expect(problemsAfter((p) => (p.story.beats[0]!.intent = intent))).toEqual([]);
      }
      expect(problemsAfter((p) => (p.story.beats[1]!.intent = 'The queue overflows'))).toEqual([]);
      expect(problemsAfter((p) => (p.story.chapters[0]!.title = 'The backlog'))).toEqual([
        ['$.story.chapters[0].title', 'term_before_intro'],
      ]);
      expect(problemsAfter((p) => (p.story.chapters[1]!.title = 'The backlog'))).toEqual([]);
      const [message] = directorPlanProblems(
        (() => {
          const p = plan();
          p.story.beats[0]!.intent = 'A burst fills the queue';
          return p;
        })(),
        ctx(),
      );
      expect(message?.message).toBe(
        'Beat "hook" uses "queue" in its intent, but beat "break" introduces it later: ' +
          'introduce it in the earlier beat or reword this intent.',
      );
    });

    it('flags a bare source line: one word, or only a source’s site or library name', () => {
      const names = ctx({ sourceNames: ['blog.acme.com', 'acme.com', 'acme'] });
      const source = (text: string) => (p: DirectorPlan) => (p.story.beats[2]!.source = text);
      expect(problemsAfter(source('glyphcut'))).toEqual([
        ['$.story.beats[2].source', 'source_label_bare'],
      ]);
      expect(problemsAfter(source('Acme.com'), names)).toEqual([
        ['$.story.beats[2].source', 'source_label_bare'],
      ]);
      for (const ok of ['glyphcut README', 'Acme engineering blog, May 2031']) {
        expect(problemsAfter(source(ok), names)).toEqual([]);
      }
    });

    it('allows only research number values (and note dates) in every prose field', () => {
      expect(
        problemsAfter((p) => {
          p.story.beats[1]!.intent = '500 requests arrive; the p99 wait is 20 ms with HTTP 503';
          p.story.runningExample = 'One request in a burst of 500 waits 20 ms.';
          p.story.beats[3]!.intent = 'The <example-date> outage sheds load';
        }),
      ).toEqual([]);
      expect(
        problemsAfter((p) => {
          p.story.beats[1]!.intent = '500 requests × 20 = 10,000 waiting';
          p.story.plantedQuestion!.text = 'Why do 40 requests fail?';
          p.story.rejectedAlternative = {
            beatId: 'break',
            summary: 'Scale to 3 servers',
            chosenBeatId: 'queue',
          };
          p.story.chapters[0]!.question = 'Why 7 seconds?';
          p.story.runningExample = 'Key 7781 sends a burst.';
          p.story.heroMetric = { label: 'Burst', value: '600 requests' };
        }),
      ).toEqual([
        ['$.story.beats[1].intent', 'number_not_in_notes'],
        ['$.story.plantedQuestion.text', 'number_not_in_notes'],
        ['$.story.rejectedAlternative.summary', 'number_not_in_notes'],
        ['$.story.chapters[0].question', 'number_not_in_notes'],
        ['$.story.runningExample', 'number_not_in_notes'],
        ['$.story.heroMetric.value', 'number_not_in_notes'],
      ]);
    });

    it('allows only research number values on the spec card', () => {
      expect(
        problemsAfter((p) => (p.story.ending.specCard!.lines[0] = 'Queue: 500 requests, 20 ms')),
      ).toEqual([]);
      expect(
        problemsAfter((p) => (p.story.ending.specCard!.lines[1] = 'Drain 1,000/s in p99 at 30 ms')),
      ).toEqual([
        ['$.story.ending.specCard.lines[1]', 'number_not_in_notes'],
        ['$.story.ending.specCard.lines[1]', 'number_not_in_notes'],
      ]);
    });
  });

  describe('layout and pattern variety per video', () => {
    const modes = (p: DirectorPlan, list: (string | undefined)[]) =>
      list.forEach((mode, i) => (p.story.beats[i]!.layoutMode = mode));

    it(`lays out at most ${MAX_SCENES_PER_LAYOUT_MODE} scenes with one mode, a chain counting once`, () => {
      const three = (p: DirectorPlan) =>
        modes(p, ['centered_focus', 'pipeline', 'centered_focus', 'pipeline', 'centered_focus']);
      expect(problemsAfter(three)).toEqual([
        ['$.story.beats[4].layoutMode', 'layout_mode_overused'],
      ]);
      // "end" continues "shed": the third centered_focus beat is the second scene's tail.
      expect(
        problemsAfter((p) => {
          modes(p, ['centered_focus', 'pipeline', 'centered_focus', 'centered_focus', undefined]);
          p.story.beats[3]!.continuesPrevious = true;
          p.story.beats[4]!.continuesPrevious = true;
        }),
      ).toEqual([]);
    });

    it('never repeats the previous scene’s mode unless it continues that scene', () => {
      expect(problemsAfter((p) => modes(p, ['centered_focus', 'centered_focus']))).toEqual([
        ['$.story.beats[1].layoutMode', 'layout_mode_repeated'],
      ]);
      expect(
        problemsAfter((p) => {
          modes(p, ['centered_focus', 'centered_focus']);
          p.story.beats[1]!.continuesPrevious = true;
        }),
      ).toEqual([]);
      // A mode-less scene between two scenes of one mode does not make them consecutive.
      expect(problemsAfter((p) => modes(p, ['pipeline', undefined, 'pipeline']))).toEqual([]);
    });

    it(`suggests one pattern on at most ${MAX_BEATS_PER_PATTERN} beats`, () => {
      expect(
        problemsAfter((p) => {
          for (const i of [1, 2, 3]) p.story.beats[i]!.suggestedPatternIds = ['fan_out'];
        }),
      ).toEqual([['$.story.beats[3].suggestedPatternIds[0]', 'pattern_overused']]);
    });

    it(`lets a scene span at most ${MAX_BEATS_PER_SCENE} beats`, () => {
      const chain = (n: number) => (p: DirectorPlan) => {
        for (let i = 1; i < n; i += 1) p.story.beats[i]!.continuesPrevious = true;
      };
      expect(problemsAfter(chain(MAX_BEATS_PER_SCENE))).toEqual([]);
      expect(problemsAfter(chain(5))).toEqual([
        ['$.story.beats[3].continuesPrevious', 'scene_too_long'],
        ['$.story.beats[4].continuesPrevious', 'scene_too_long'],
      ]);
    });

    it('starts every video and part on a new board', () => {
      expect(problemsAfter((p) => (p.story.beats[0]!.continuesPrevious = true))).toEqual([
        ['$.story.beats[0].continuesPrevious', 'continues_without_previous'],
      ]);
      expect(
        problemsAfter((p) => {
          twoParts(p);
          p.story.beats[2]!.continuesPrevious = true;
        }),
      ).toEqual([['$.story.beats[2].continuesPrevious', 'continues_without_previous']]);
    });

    it('counts per video: each part has its own budget', () => {
      expect(
        problemsAfter((p) => {
          twoParts(p);
          modes(p, ['pipeline', 'centered_focus', 'pipeline', 'centered_focus', 'pipeline']);
        }),
      ).toEqual([]);
    });
  });

  describe('variety', () => {
    it(`allows ${MAX_RECENT_COMBO_REUSE} recent device/layout combo, then flags every reuse`, () => {
      const recentCombos = ['contention_hook/centered_focus', 'failure_before_fix/pipeline'];
      expect(problemsAfter(() => {}, ctx({ recentCombos }))).toEqual([]);
      expect(
        problemsAfter((p) => (p.story.beats[1]!.layoutMode = 'pipeline'), ctx({ recentCombos })),
      ).toEqual([
        ['$.story.beats[0]', 'recent_combo_reused'],
        ['$.story.beats[1]', 'recent_combo_reused'],
      ]);
    });

    /** Two suggested patterns, so the plan has a main sequence: `<a>><b>`. */
    const withPatterns = (p: DirectorPlan) => {
      p.story.beats[1]!.suggestedPatternIds = ['example-pattern-a'];
      p.story.beats[3]!.suggestedPatternIds = ['example-pattern-b'];
    };
    const recent = (title: string, hooks: string[], sequences: string[] = []) => ({
      title,
      hooks,
      sequences,
    });

    it('flags the structure of any recent video: the same hook and main pattern sequence', () => {
      const recentStructures = [
        recent('Newest', ['puzzle/planted_question']),
        recent('Older', ['problem/contention_hook'], ['example-pattern-a>example-pattern-b']),
      ];
      const found = problemsAfter(withPatterns, ctx({ recentStructures }));
      expect(found).toEqual([['$.story.beats[0]', 'structure_repeated']]);
      expect(isAdvisoryPlanCode('structure_repeated')).toBe(false);
      // Another sequence (or none) is not the same structure.
      expect(problemsAfter(() => {}, ctx({ recentStructures }))).toEqual([]);
    });

    it("warns when the hook is the previous video's, whatever its patterns", () => {
      const recentStructures = [recent('Newest', ['problem/contention_hook'])];
      expect(problemsAfter(() => {}, ctx({ recentStructures }))).toEqual([
        ['$.story.beats[0]', 'hook_repeated'],
      ]);
      expect(isAdvisoryPlanCode('hook_repeated')).toBe(true);
      // Only the previous video's hook counts; a puzzle hook is another hook.
      const older = [recent('Newest', ['puzzle/x']), recent('Older', ['problem/contention_hook'])];
      expect(problemsAfter(() => {}, ctx({ recentStructures: older }))).toEqual([]);
      expect(
        problemsAfter((p) => (p.story.hook = { kind: 'puzzle' }), ctx({ recentStructures })),
      ).not.toContainEqual(['$.story.beats[0]', 'hook_repeated']);
    });

    it('checks each part on its own hook', () => {
      const recentStructures = [recent('Newest', ['problem/failure_before_fix'])];
      const found = problemsAfter(twoParts, ctx({ recentStructures }));
      expect(found).toContainEqual(['$.story.beats[3]', 'hook_repeated']);
      expect(found.filter(([, code]) => code === 'hook_repeated')).toHaveLength(1);
    });
  });
});

describe('specFromPlan', () => {
  it('adds the code-owned fields and lets the run format win', () => {
    const spec = specFromPlan(plan(), {
      id: 'queues',
      series: 'system-design',
      formatOverride: 'card',
      seriesNumber: 12,
    });
    expect(spec.meta).toEqual({
      id: 'queues',
      series: 'system-design',
      title: 'Why queues shed load',
      topicClass: 'concept',
      targetLengthSec: 60,
      format: 'card',
    });
    expect(spec.story.ending.seriesNumber).toBe(12);
  });

  it('uses the parts’ total, within the hard limits, for a multi-part plan', () => {
    const p = plan();
    twoParts(p);
    expect(specFromPlan(p, { id: 'q', series: 's' }).meta.targetLengthSec).toBe(90);
    p.parts![0]!.targetLengthSec = 150;
    p.parts![1]!.targetLengthSec = 150;
    expect(specFromPlan(p, { id: 'q', series: 's' }).meta.targetLengthSec).toBe(170);
  });
});
