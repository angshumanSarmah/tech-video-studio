import { describe, expect, it } from 'vitest';
import { directorPlanProblems } from '../director/checks.ts';
import { DirectorPlanSchema } from '../director/plan.ts';
import { ResearchNotesSchema, type ResearchNotes } from '../research/notes.ts';
import { VideoSpecShapeSchema, type VideoSpec } from '../spec/shape.ts';
import { validSpec } from '../spec/test-fixtures.ts';
import { readability, syllables } from '../text/readability.ts';
import { hookNumberRepeats } from './hook-numbers.ts';
import { planOfSpec } from './plan-of-spec.ts';
import { readabilityProblems } from './readability-checks.ts';
import { BEAT_OVER_TARGET_RATIO, timedLengthProblems } from './timed-length.ts';

const C = ['source-1#chunk-1'];

/** Notes with the numbers the tests say (invented). */
function notes(numbers: [id: string, value: string, unit: string][]): ResearchNotes {
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
    numbers: numbers.map(([id, value, unit]) => ({
      id,
      value,
      unit,
      context: '<example-context>',
      sourceChunkId: C[0],
    })),
    tradeOffs: [],
    rejectedAlternatives: [],
    misconceptions: [],
    failureModes: [],
    hooks: [
      { situation: 'A flood.', sourceChunkIds: C },
      { situation: 'A bucket.', sourceChunkIds: C },
    ],
    openQuestions: [],
  });
}

type Input = ReturnType<typeof validSpec>;

function spec(change: (input: Input) => void = () => undefined): VideoSpec {
  const input = validSpec();
  change(input);
  return VideoSpecShapeSchema.parse(input);
}

const codes = (issues: readonly { path: string; code: string }[]) =>
  issues.map((i) => `${i.path} ${i.code}`);

describe('readability', () => {
  it('counts syllables by vowel group, dropping silent endings', () => {
    expect([syllables('the'), syllables('make'), syllables('bucket')]).toEqual([1, 1, 2]);
    expect([syllables('request'), syllables('replica'), syllables('failover')]).toEqual([2, 3, 3]);
  });

  it('scores short everyday sentences high and long latinate ones low', () => {
    const plain = readability('The bucket holds ten tokens. Each request spends one.');
    const dense = readability(
      'Consequently, administrative infrastructure necessitates comprehensive operational ' +
        'reconfiguration whenever distributed coordination mechanisms deteriorate unexpectedly.',
    );
    expect(plain?.score).toBeGreaterThan(70);
    expect(dense?.score).toBeLessThan(0);
    expect(dense?.longWords).toContain('infrastructure');
    expect(readability('...')).toBeUndefined();
  });

  it('warns below the level threshold only', () => {
    const dense = spec((s) => {
      s.script![1]!.narration =
        'Consequently, administrative infrastructure necessitates comprehensive reconfiguration.';
    });
    expect(codes(readabilityProblems(dense, 'beginner'))).toEqual([
      '$.script[1].narration readability_low',
    ]);
    expect(readabilityProblems(dense, 'expert')).toEqual([]);
  });
});

describe('timedLengthProblems', () => {
  /** Beats back to back, each `spans[i]` seconds long; narration fills all but 0.2 s. */
  function timed(spans: number[], targets: number[], endTailSec = 0.5): VideoSpec {
    return spec((s) => {
      let at = 0;
      s.story.beats.forEach((b, i) => (b.targetSec = targets[i] ?? 15));
      s.timing!.beats = s.timing!.beats.map((b, i) => {
        const startSec = at;
        at += spans[i] ?? 0;
        return { ...b, startSec, endSec: at - 0.2, words: [] };
      });
      s.timing!.endSec = at + endTailSec;
      s.timing!.pauses = { beatGapSec: 0, landingSec: 0, endTailSec };
    });
  }
  const video = { lengthMinSec: 30, lengthMaxSec: 60 };

  it('flags a beat over its plan by more than the ratio, with words to cut', () => {
    const over = BEAT_OVER_TARGET_RATIO + 0.05;
    const found = timedLengthProblems(timed([15 * over, 15 * 0.8, 15], [15, 15, 15]), { video });
    expect(codes(found)).toEqual(['$.script[0].narration beat_over_target']);
    expect(found[0]?.message).toMatch(/runs 19\.5 s against its planned 15 s \(130%.*Cut about/);
  });

  it('measures the last beat without the end tail', () => {
    expect(timedLengthProblems(timed([15, 15, 18], [15, 15, 15], 3), { video })).toEqual([]);
  });

  it('flags the video over its target, naming the beats most over', () => {
    const found = timedLengthProblems(timed([18, 18, 15], [15, 15, 15]), { video });
    expect(codes(found)).toEqual(['$.script video_over_target']);
    expect(found[0]?.message).toContain('hook +3 s, bucket-intro +3 s');
  });

  it('compares with the fixed length when the run has one, and skips the range then', () => {
    const fixed = timed([15, 15, 15], [15, 15, 15]);
    expect(codes(timedLengthProblems(fixed, { video, lengthOverrideSec: 40 }))).toEqual([
      '$.script video_over_target',
    ]);
    const short = { lengthMinSec: 50, lengthMaxSec: 60 };
    expect(codes(timedLengthProblems(fixed, { video: short }))).toEqual([
      '$.script video_out_of_range',
    ]);
    expect(timedLengthProblems(fixed, { video: short, lengthOverrideSec: 45 })).toEqual([]);
  });

  it('measures nothing before TTS', () => {
    expect(
      timedLengthProblems(
        spec((s) => delete s.timing),
        { video },
      ),
    ).toEqual([]);
  });
});

describe('hookNumberRepeats', () => {
  const hookNotes = notes([
    ['num-1', '10,000', 'requests per second'],
    ['num-2', '47', 'minutes'],
    ['num-3', '47', 'nodes'],
  ]);

  function hooked(change: (s: Input) => void): VideoSpec {
    return spec((s) => {
      s.story.beats[0]!.hookNumberIds = ['num-1', 'num-2'];
      s.story.beats[0]!.factIds = ['fact-1'];
      change(s);
    });
  }

  it("flags a later beat that says the hook's number again", () => {
    const found = hookNumberRepeats(
      hooked((s) => (s.script![2]!.narration = 'So ten thousand requests a second hit it.')),
      hookNotes,
    );
    expect(codes(found)).toEqual(['$.script[2].narration hook_number_repeated']);
    expect(found[0]?.message).toContain('"ten thousand" says the hook\'s number again (num-1');
  });

  it('accepts the same value when the beat cites another number that has it', () => {
    const spec = hooked((s) => {
      s.script![2]!.narration = 'Forty-seven nodes share one store.';
      s.story.beats[2]!.factIds = ['num-3'];
    });
    expect(hookNumberRepeats(spec, hookNotes)).toEqual([]);
  });

  it('ignores the hook itself, everyday words and a spec without hook numbers', () => {
    const everyday = hooked(
      (s) => (s.script![1]!.narration = 'One bucket, two tokens, three tries.'),
    );
    expect(hookNumberRepeats(everyday, hookNotes)).toEqual([]);
    expect(
      hookNumberRepeats(
        hooked(() => undefined),
        hookNotes,
      ),
    ).toEqual([]);
    expect(hookNumberRepeats(spec(), hookNotes)).toEqual([]);
  });
});

describe('planOfSpec', () => {
  it('is a Director plan without the series number, so the plan checks run on a spec', () => {
    const parsed = spec((s) => {
      s.story.ending.seriesNumber = 7;
      s.story.beats[0]!.factIds = ['fact-9'];
    });
    const plan = planOfSpec(parsed);
    expect(DirectorPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.story.ending).not.toHaveProperty('seriesNumber');
    expect(parsed.story.ending.seriesNumber).toBe(7);
    const ctx = {
      notes: notes([]),
      video: {
        lengthMinSec: 30,
        lengthMaxSec: 60,
        lengthReasonAboveSec: 45,
        allowParts: true,
        maxParts: 4,
        wordsPerSec: 2.56,
        explanationLevel: 'expert' as const,
      },
      recentCombos: [],
      series: { name: 'System Design', label: 'SYSTEM DESIGN' },
    };
    expect(directorPlanProblems(plan, ctx).map((p) => p.code)).toContain('unknown_fact');
  });
});
