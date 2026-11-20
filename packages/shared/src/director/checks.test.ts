import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VideoSettingsSchema, type VideoSettings } from '../config/video.ts';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import { MAX_HOOK_NUMBERS } from '../spec/story.ts';
import { validateVideoSpec } from '../spec/validate.ts';
import {
  directorPlanProblems,
  MAX_BEATS_PER_DEVICE,
  MAX_RECENT_COMBO_REUSE,
  MIN_PAYOFF_GAP_BEATS,
  type DirectorCheckContext,
} from './checks.ts';
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
            p.story.beats[3]!.source = '<example-source>';
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
