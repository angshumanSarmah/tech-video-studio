import { curatorCodeChecks } from '@explainer-studio/renderer/catalog';
import { getTheme } from '@explainer-studio/renderer/theme';
import {
  curatorIssueProblems,
  DEFAULT_VIDEO_SETTINGS,
  type CuratorIssue,
} from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { FIXTURE_WORDS_PER_SEC, fixtureTopic, type FixtureTopicId } from '../fixture-topics.ts';
import { fixtureGeneratedSpec, recordedNotes } from '../generator/testing.ts';
import { curatorUserMessage, reviewBeatTexts } from './input.ts';

const SERIES = {
  'rate-limiter': { name: 'System Design', label: 'SYSTEM DESIGN' },
  tokenizer: { name: 'AI', label: 'AI' },
} as const;

function message(topic: FixtureTopicId, round?: Parameters<typeof curatorUserMessage>[0]['round']) {
  const spec = fixtureGeneratedSpec(topic);
  const notes = recordedNotes(topic);
  const video = { ...DEFAULT_VIDEO_SETTINGS, wordsPerSec: FIXTURE_WORDS_PER_SEC };
  const codeIssues = curatorCodeChecks(spec, {
    theme: getTheme(),
    notes,
    topicTitle: fixtureTopic(topic).topic.title,
    series: SERIES[topic],
    channelHandle: null,
    video,
    pauses: { beatGapSec: 0, landingSec: 0 },
    recent: { combos: [], patterns: [] },
  });
  return curatorUserMessage({
    spec,
    notes,
    level: video.explanationLevel,
    codeIssues,
    ...(round ? { round } : {}),
  });
}

describe('curatorUserMessage', () => {
  it.each(['rate-limiter', 'tokenizer'] as const)('%s: what the review reads', async (topic) => {
    await expect(message(topic)).toMatchFileSnapshot(`./__snapshots__/${topic}.message.txt`);
  });

  it('describes a board in words a quote can be checked against', () => {
    const text = message('rate-limiter');
    expect(text).toContain(
      '- latency · counter_transition · unit "ms" · label "round trip per request" · from 0.4 · to 2.1',
    );
    expect(text).toContain('enter on 18 "zero"');
    expect(text).toContain('focus: trip from the start → latency on 18 "zero"');
    // "forty times its contracted rate": the only research number with that value is a count.
    expect(text).toContain('- narration "forty" → num-18 (40 instances)');
    expect(text).toContain(
      '- board node_a subtitle "one of 24 nodes" → num-3 (24 gateway nodes) or num-4 (24 times its limit)',
    );
    expect(text).toContain('- beat_over_target (blocking, scriptwriter)');
    expect(text).not.toContain('source-1#chunk');
    expect(text).not.toContain('PREVIOUS ISSUES');
  });

  it('adds the earlier issues and the changed beats in a second round', () => {
    const issue: CuratorIssue = {
      beatId: 'beat5',
      category: 'number_wrong_meaning',
      severity: 'blocking',
      owner: 'generator',
      fields: ['board'],
      evidence: [
        { kind: 'label', elementId: 'latency', quote: 'round trip per request' },
        { kind: 'number', id: 'num-6' },
      ],
      problem: '<example-problem>',
      fix: '<example-fix>',
    };
    const text = message('rate-limiter', {
      previous: [{ id: 'issue-1', issue }],
      changedBeatIds: ['beat5'],
    });
    expect(text).toContain('BEAT beat5 (5 of 8) · chapter');
    expect(text).toMatch(/BEAT beat5 .*· CHANGED since the last review/);
    expect(text).not.toMatch(/BEAT beat4 .*CHANGED/);
    expect(text).toContain(
      '- issue-1 · beat5 · number_wrong_meaning · blocking · generator: <example-problem> ' +
        'Evidence: label latency "round trip per request"; number num-6. Fix asked: <example-fix>',
    );
    expect(text.trimEnd().endsWith('beat5')).toBe(true);
  });
});

describe('reviewBeatTexts', () => {
  it('lets a quote of anything the message shows verify', () => {
    const spec = fixtureGeneratedSpec('rate-limiter');
    const beats = reviewBeatTexts(spec);
    const review = {
      issues: [
        {
          beatId: 'beat5',
          category: 'number_wrong_meaning',
          severity: 'blocking',
          owner: 'generator',
          fields: ['board'],
          evidence: [
            { kind: 'label', elementId: 'latency', quote: '2.1' },
            { kind: 'label', elementId: 'slow-tag', quote: 'slow store' },
            { kind: 'number', id: 'num-6' },
            {
              kind: 'narration',
              quote: 'Say the median round trip ... zero point four milliseconds',
            },
            { kind: 'source', quote: 'A field guide to token-bucket rate limiting' },
          ],
          problem: '<example-problem>',
          fix: '<example-fix>',
        },
        {
          beatId: 'beat4',
          category: 'visual_distracts',
          severity: 'advisory',
          owner: 'generator',
          fields: ['board'],
          evidence: [{ kind: 'label', elementId: 'store_node', quote: 'IN-MEMORY STORE' }],
          problem: '<example-problem>',
          fix: '<example-fix>',
        },
      ],
    };
    expect(curatorIssueProblems(review, { beats, notes: recordedNotes('rate-limiter') })).toEqual(
      [],
    );
  });
});
