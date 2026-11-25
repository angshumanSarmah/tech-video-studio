import {
  DEFAULT_VIDEO_SETTINGS,
  DIRECTOR_PROBLEM_CODES,
  ResearchNotesSchema,
  SCRIPT_PROBLEM_CODES,
  SPEC_WARNING_CODES,
  type RenderableVideoSpec,
  type ResearchNotes,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { allFixtureSpecs, goldenRateLimiterSpec, withFormat } from '../../fixtures/index.ts';
import { LAYOUT_WARNING_CODES } from '../layout/types.ts';
import { specLayoutWarnings } from '../layout/spec-layout.ts';
import { getTheme } from '../theme/index.ts';
import {
  BLOCKING_WARNING_CODES,
  CURATOR_CODE_POLICY,
  curatorCodeChecks,
  ownerOfPath,
  type CuratorCheckContext,
} from './curator-checks.ts';
import { MAX_RECENT_PATTERN_REUSE, patternVarietyWarnings } from './variety-checks.ts';

const C = ['source-1#chunk-1'];

/** Notes with a few of the golden rate limiter's numbers (invented, like the fixture). */
function notes(): ResearchNotes {
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
      {
        id: 'num-1',
        value: '10,000',
        unit: 'requests per second',
        context: '<example-context>',
        sourceChunkId: C[0],
      },
      {
        id: 'num-2',
        value: '100',
        unit: 'tokens',
        context: '<example-context>',
        sourceChunkId: C[0],
      },
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

function context(recentPatterns: readonly string[] = []): CuratorCheckContext {
  return {
    theme: getTheme(),
    notes: notes(),
    topicTitle: 'Rate limiters',
    series: { name: 'System Design', label: 'SYSTEM DESIGN' },
    channelHandle: '@example',
    video: DEFAULT_VIDEO_SETTINGS,
    pauses: { beatGapSec: 0, landingSec: 0 },
    recent: { combos: [], patterns: recentPatterns },
  };
}

describe('CURATOR_CODE_POLICY', () => {
  it('rates every code the plan, script, layout and spec checks can raise', () => {
    const planOnly = new Set([
      'target_length_missing',
      'target_length_override',
      'target_length_out_of_range',
      'target_length_mismatch',
      'length_reason_missing',
      'parts_not_allowed',
      'too_many_parts',
      'part_order',
      'unknown_beat',
      'parts_cover_beats',
      'chapter_spans_parts',
      'payoff_in_other_part',
      'chosen_in_other_part',
    ]);
    const known = [
      ...SPEC_WARNING_CODES,
      ...LAYOUT_WARNING_CODES,
      ...SCRIPT_PROBLEM_CODES,
      ...DIRECTOR_PROBLEM_CODES.filter((c) => !planOnly.has(c)),
    ];
    expect(known.filter((code) => !(code in CURATOR_CODE_POLICY))).toEqual([]);
    for (const code of BLOCKING_WARNING_CODES) expect(CURATOR_CODE_POLICY[code]).toBe('blocking');
  });

  it('rates every warning raised on any fixture spec, in both formats', () => {
    const specs = allFixtureSpecs.flatMap((spec) => [spec, withFormat(spec, 'card')]);
    const unrated = specs.flatMap((spec) =>
      curatorCodeChecks(spec, context(['versus_split']))
        // Unrated warnings fall back to advisory; errors are blocking and need no rating.
        .filter((issue) => issue.severity === 'advisory' && !(issue.code in CURATOR_CODE_POLICY))
        .map((issue) => `${spec.meta.id} ${issue.code}`),
    );
    expect(unrated).toEqual([]);
  });
});

describe('curatorCodeChecks: a part of a multi-part video (meta.part)', () => {
  /** The golden rate limiter as part `index` of 2: part 1 ends on its cliffhanger. */
  function asPart(index: number | undefined, cliffhanger: boolean): RenderableVideoSpec {
    const spec = structuredClone(goldenRateLimiterSpec);
    if (index !== undefined) spec.meta.part = { index, count: 2 };
    if (cliffhanger) {
      spec.story.ending = { kind: 'cliffhanger_ending' };
      spec.story.beats.at(-1)!.device = 'cliffhanger_ending';
    }
    return spec;
  }
  const codes = (spec: RenderableVideoSpec) =>
    curatorCodeChecks(spec, context([])).map((i) => i.code);

  it('takes part 1’s cliffhanger as its ending, not as a video that never closes', () => {
    expect(codes(asPart(undefined, true))).toContain('ending_kind');
    expect(codes(asPart(1, true))).not.toContain('ending_kind');
    expect(codes(asPart(1, true))).not.toContain('cliffhanger_missing');
  });

  it('checks a part’s own edges: part 1 ends on a cliffhanger, part 2 opens with a recap', () => {
    expect(codes(asPart(1, false))).toContain('cliffhanger_missing');
    expect(codes(asPart(2, false))).toContain('recap_missing');
    expect(codes(asPart(2, false))).not.toContain('ending_kind');
  });
});

describe('curatorCodeChecks', () => {
  it('gives each finding the owner of what its path points at', () => {
    expect(ownerOfPath('$.scenes[2].elements[0].props.title')).toBe('generator');
    expect(ownerOfPath('$.script[1].narration')).toBe('scriptwriter');
    expect(ownerOfPath('$.timing.beats[0]')).toBe('scriptwriter');
    expect(ownerOfPath('$.story.beats[0].factIds[1]')).toBe('director');
    expect(ownerOfPath('$.meta.title')).toBe('director');
  });

  it('reports text size after the camera in place of the board-scale warning', () => {
    const card = withFormat(goldenRateLimiterSpec, 'card');
    const chainLevel = specLayoutWarnings(card, getTheme()).filter(
      (w) => w.code === 'text_too_small',
    );
    expect(chainLevel.length).toBeGreaterThan(0);
    const codes = curatorCodeChecks(card, context()).map((i) => i.code);
    expect(codes).not.toContain('text_too_small');
    expect(codes).toContain('text_too_small_on_screen');
  });

  it('reports pattern reuse against recent videos past the first', () => {
    const spec: RenderableVideoSpec = goldenRateLimiterSpec;
    expect(patternVarietyWarnings(spec, ['versus_split'])).toEqual([]);
    const reused = patternVarietyWarnings(spec, ['versus_split', 'flood_then_funnel']);
    expect(MAX_RECENT_PATTERN_REUSE).toBe(1);
    expect(reused.map((w) => `${w.path} ${w.code}`)).toEqual([
      '$.scenes[6].patterns[0] pattern_recently_used',
    ]);
    expect(reused[0]?.message).toContain('already reuses versus_split');
    const issue = curatorCodeChecks(spec, context(['versus_split', 'flood_then_funnel'])).find(
      (i) => i.code === 'pattern_recently_used',
    );
    expect(issue).toMatchObject({ severity: 'advisory', owner: 'generator' });
  });
});
