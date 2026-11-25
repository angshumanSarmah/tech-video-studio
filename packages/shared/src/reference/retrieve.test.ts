import { describe, expect, it } from 'vitest';
import { referenceBrief } from './brief.ts';
import { notesTextOf, referenceReuseProblems, titleWordSimilarity } from './originality.ts';
import {
  ReferenceRecordSchema,
  withoutBeatDevicesInVideoDevices,
  type ReferenceRecord,
} from './record.ts';
import {
  candidateDevices,
  expectedClass,
  MAX_REFERENCES,
  pickReferences,
  referenceFingerprint,
  type RetrievalInput,
} from './retrieve.ts';

/** An invented record: class, hook device, devices and patterns are what scoring reads. */
function record(
  over: {
    topicClass?: ReferenceRecord['topicClass'];
    secondaryTopicClass?: ReferenceRecord['topicClass'];
    hookDevice?: ReferenceRecord['hook']['device'];
    devices?: ReferenceRecord['beats'][number]['devices'];
    patterns?: string[];
    series?: string[];
  } = {},
): ReferenceRecord {
  const hookDevice = over.hookDevice ?? 'contention_hook';
  return ReferenceRecordSchema.parse({
    title: 'an invented reference',
    series: over.series ?? ['system-design'],
    topicClass: over.topicClass ?? 'product-design',
    ...(over.secondaryTopicClass ? { secondaryTopicClass: over.secondaryTopicClass } : {}),
    format: 'full',
    hook: { kind: 'problem', device: hookDevice, shape: 'Many reach for one thing.' },
    arc: 'hook → steps → ending',
    beats: [
      { role: 'hook', summary: 'The hook.', devices: [hookDevice] },
      {
        role: 'step',
        summary: 'A step.',
        devices: over.devices ?? [],
        patterns: over.patterns ?? [],
        layoutMode: 'pipeline',
      },
      { role: 'ending', summary: 'The end.', continuesPrevious: true },
    ],
  });
}

function input(over: Partial<RetrievalInput> = {}): RetrievalInput {
  return {
    topicTitle: 'Rate limiters',
    seriesTag: 'system-design',
    recent: { structures: [], referencesShown: {} },
    references: [],
    ...over,
  };
}

describe('expectedClass', () => {
  it('takes a previous plan’s class, then the title’s, then the series’', () => {
    expect(expectedClass(input({ previousTopicClass: 'internals' }))).toEqual({
      topicClass: 'internals',
      from: 'previous_plan',
    });
    expect(expectedClass(input())).toEqual({ topicClass: 'concept', from: 'title' });
    expect(
      expectedClass(input({ topicTitle: 'How an LLM tokenizer works', seriesTag: 'ai' })),
    ).toEqual({ topicClass: 'ai-ml', from: 'title' });
    // A tie between classes goes to the series' class.
    expect(
      expectedClass(input({ topicTitle: 'KV cache in transformers', seriesTag: 'ai' })),
    ).toEqual({ topicClass: 'ai-ml', from: 'title' });
    expect(expectedClass(input({ topicTitle: 'Something new', seriesTag: 'ai' }))).toEqual({
      topicClass: 'ai-ml',
      from: 'series',
    });
    expect(expectedClass(input({ topicTitle: 'Something new' }))).toBeUndefined();
  });
});

describe('candidateDevices', () => {
  it('adds what the notes support to the class’s preferred devices', () => {
    const notes = {
      failureModes: [{ kind: 'incident' }],
      rejectedAlternatives: [],
      misconceptions: [{}],
      numbers: [{}, {}, {}],
    } as unknown as Parameters<typeof candidateDevices>[1];
    expect(candidateDevices(undefined, notes)).toEqual([
      'real_incident',
      'what_breaks',
      'failure_before_fix',
      'seen_this_bug',
      'hero_metric',
    ]);
    expect(candidateDevices('concept', undefined)[0]).toBe('failure_before_fix');
  });
});

describe('pickReferences', () => {
  const refs = [
    {
      slug: 'a-incident',
      record: record({
        topicClass: 'concept',
        hookDevice: 'what_breaks',
        devices: ['failure_before_fix', 'real_incident'],
      }),
    },
    {
      slug: 'b-versus',
      record: record({ hookDevice: 'contention_hook', devices: ['versus_split'] }),
    },
    {
      slug: 'c-same-hook',
      record: record({ hookDevice: 'contention_hook', devices: ['versus_split', 'seen_this_bug'] }),
    },
    { slug: 'd-nothing', record: record({ hookDevice: 'persona_hook', series: ['ai'] }) },
  ];

  it('scores class, shared devices and series, and picks the best above the floor', () => {
    const result = pickReferences(input({ references: refs }));
    expect(result.scored.map((s) => [s.slug, s.score])).toEqual([
      ['a-incident', 7],
      ['c-same-hook', 3],
      ['b-versus', 2],
      ['d-nothing', 0],
    ]);
    expect(result.scored[0]!.reasons).toEqual([
      'class concept +3',
      'devices what_breaks, failure_before_fix, real_incident +3',
      'series system-design +1',
    ]);
    // b shares c's hook device, so only the better of the two is shown.
    expect(result.picks.map((p) => p.slug)).toEqual(['a-incident', 'c-same-hook']);
  });

  it('pushes down a structure a recent video used, and references shown recently', () => {
    const { hook } = referenceFingerprint(refs[0]!.record);
    const result = pickReferences(
      input({
        references: refs,
        recent: {
          structures: [{ title: null, hooks: [hook], sequences: [] }],
          referencesShown: { 'a-incident': 2 },
        },
      }),
    );
    const a = result.scored.find((s) => s.slug === 'a-incident')!;
    expect(a.score).toBe(3);
    expect(a.reasons).toContain(`hook ${hook} used by a recent video −2`);
    expect(a.reasons).toContain('shown for 2 recent video(s) −2');
  });

  it('shows at most three, and none below the floor', () => {
    const many = ['what_breaks', 'persona_hook', 'contention_hook', 'interview_hook', 'puzzle']
      .slice(0, 4)
      .map((hookDevice, i) => ({
        slug: `ref-${i}`,
        record: record({ topicClass: 'concept', hookDevice: hookDevice as 'what_breaks' }),
      }));
    expect(pickReferences(input({ references: many })).picks).toHaveLength(MAX_REFERENCES);
    expect(
      pickReferences(input({ topicTitle: 'Something new', references: [refs[3]!] })).picks,
    ).toEqual([]);
  });
});

describe('referenceBrief', () => {
  it('shows structure only, with a label instead of the slug', () => {
    const r = {
      ...record({ patterns: ['atomic_lock', 'retired_pattern'] }),
      namesToAvoid: [{ text: 'Acme', kind: 'brand' as const }],
    };
    const brief = referenceBrief(
      r,
      1,
      { slug: 'x', score: 3, reasons: ['class concept +3', 'shown for 1 recent video(s) −1'] },
      new Set(['atomic_lock']),
    );
    expect(brief.label).toBe('Reference B');
    expect(brief.whyPicked).toBe('class concept');
    expect(brief.beats[1]).toBe('step: A step. [patterns atomic_lock; layout pipeline]');
    expect(brief.beats[2]).toBe('ending: The end. [continues the previous board]');
    const text = JSON.stringify(brief);
    expect(text).not.toContain('Acme');
    expect(text).not.toContain('an invented reference');
    expect(text).not.toContain('retired_pattern');
  });

  it('shows only whole-video devices as spanning the video', () => {
    const r = { ...record(), videoDevices: ['persona_hook' as const, 'hero_metric' as const] };
    const brief = referenceBrief(r, 0, { slug: 'x', score: 3, reasons: [] });
    expect(brief.videoDevices).toEqual(['hero_metric']);
  });
});

describe('withoutBeatDevicesInVideoDevices', () => {
  it('drops a whole-video device that a beat carries, and keeps the rest', () => {
    const r = {
      ...record({ devices: ['planted_question'] }),
      videoDevices: ['planted_question' as const, 'roadmap' as const],
    };
    expect(withoutBeatDevicesInVideoDevices(r).videoDevices).toEqual(['roadmap']);
    // The hook beat's device counts too; a record with nothing to drop is returned as is.
    const hook = { ...record(), videoDevices: ['contention_hook' as const] };
    expect(withoutBeatDevicesInVideoDevices(hook).videoDevices).toEqual([]);
    const clean = record();
    expect(withoutBeatDevicesInVideoDevices(clean)).toBe(clean);
  });
});

describe('referenceReuseProblems', () => {
  const ctx = {
    references: [
      {
        slug: 'seat-booking',
        names: [
          { text: 'Ticketo', kind: 'brand' as const },
          { text: 'Who gets the last seat?', kind: 'title' as const },
          { text: 'Notora', kind: 'brand' as const },
        ],
      },
    ],
    notesText: notesTextOf({ facts: [{ text: 'Notora publishes its limits.' }] }),
  };

  it('flags a reference’s names and title, but not a name the notes use', () => {
    const problems = referenceReuseProblems(
      [
        { path: '$.meta.title', text: 'Who gets the last seat', isTitle: true },
        { path: '$.story.beats[0].intent', text: 'Two Ticketos race for one hold.' },
        { path: '$.story.beats[1].intent', text: 'Notora limits each key.' },
        { path: '$.story.beats[2].intent', text: 'A seat is held for one buyer.' },
      ],
      ctx,
    );
    expect(problems.map((p) => [p.path, p.code])).toEqual([
      ['$.meta.title', 'reference_title_reused'],
      ['$.story.beats[0].intent', 'reference_name_reused'],
    ]);
    expect(problems[1]!.message).toContain('reference seat-booking');
  });

  it('tells a copied title from one on the same topic', () => {
    expect(
      titleWordSimilarity('Who gets the very last seat', 'Who gets the last seat?'),
    ).toBeCloseTo(0.83, 2);
    expect(titleWordSimilarity('How a rate limiter works', 'A rate limiter, explained')).toBe(0.5);
  });

  it('reads a title close to a reference title as reused, only where a title goes', () => {
    const texts = [
      { path: '$.meta.title', text: 'Who gets the very last seat', isTitle: true },
      { path: '$.script[0].narration', text: 'Who gets the very last seat' },
    ];
    expect(referenceReuseProblems(texts, ctx).map((p) => p.path)).toEqual(['$.meta.title']);
  });
});
