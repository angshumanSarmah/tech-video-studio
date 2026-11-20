import type { VideoSpecInput } from './shape.ts';

/** A small, fully valid spec (all layers). Returns a fresh copy so tests can mutate it. */
export function validSpec(): VideoSpecInput {
  return {
    schemaVersion: 1,
    meta: {
      id: 'rate-limiter',
      series: 'system-design',
      title: 'How a rate limiter works',
      topicClass: 'concept',
      targetLengthSec: 45,
    },
    story: {
      devices: ['failure_before_fix', 'planted_question'],
      heroMetric: {
        label: 'Token bucket',
        value: '10 tokens/s',
        storyClock: {
          from: 'Spike',
          to: 'Stable',
          startValue: 0,
          endValue: 180,
          keyframes: [{ beatId: 'bucket-empty', value: 120 }],
        },
      },
      chapters: [
        { id: 'flood', title: 'The flood', question: 'Why did the API fall over?' },
        { id: 'bucket', title: 'Token bucket' },
      ],
      beats: [
        {
          id: 'hook',
          chapterId: 'flood',
          intent: 'One client floods the API',
          device: 'failure_before_fix',
          targetSec: 15,
          factIds: ['fact-1'],
          layoutMode: 'centered_focus',
          suggestedPatternIds: ['flood_then_funnel'],
        },
        { id: 'bucket-intro', chapterId: 'bucket', intent: 'Tokens refill', targetSec: 15 },
        { id: 'bucket-empty', chapterId: 'bucket', intent: 'Empty bucket rejects', targetSec: 15 },
      ],
      plantedQuestion: {
        text: 'Why did the API fall over?',
        beatId: 'hook',
        payoffBeatId: 'bucket-empty',
      },
      rejectedAlternative: { beatId: 'hook', summary: 'Scaling servers alone' },
      ending: { kind: 'callback_ending', cta: 'Share with the teammate who DDoSed staging' },
      missingPrimitiveRequests: [
        { name: 'bucket', description: 'A bucket that fills with tokens', fallbackUsed: 'counter' },
      ],
    },
    script: [
      {
        beatId: 'hook',
        narration: 'One client sends ten thousand requests. The API falls over.',
        headline: {
          text: 'Rate limit = cap requests per client',
          semantic: 'concept',
          at: { type: 'word_text', text: 'falls' },
        },
        tags: ['429'],
        statCards: [{ value: '10k/s', label: 'peak load', sourceRef: 'fact-1' }],
      },
      { beatId: 'bucket-intro', narration: 'Each client gets a bucket of tokens.' },
      {
        beatId: 'bucket-empty',
        narration: 'No token, no request. The bucket says no.',
        formulaCard: { latex: 'r = \\frac{tokens}{s}' },
      },
    ],
    scenes: [
      {
        beatId: 'hook',
        kind: 'board',
        layoutMode: 'centered_focus',
        elements: [
          { id: 'client', primitive: 'node_card', props: { title: 'Client' } },
          { id: 'api', primitive: 'node_card', props: { title: 'API' }, role: 'focus' },
        ],
        patterns: [{ id: 'flood', pattern: 'flood_then_funnel', params: { count: 20 } }],
        events: [
          { at: { type: 'word', index: 0 }, action: 'enter', targets: ['client'] },
          { at: { type: 'word_text', text: 'falls' }, action: 'reject', targets: ['api', 'flood'] },
        ],
        focus: ['api'],
      },
      {
        beatId: 'bucket-intro',
        kind: 'board',
        layoutMode: 'centered_focus',
        continuesPrevious: true,
        elements: [{ id: 'bucket', primitive: 'counter', props: { value: 10 } }],
        events: [
          { at: { type: 'word_text', text: 'bucket' }, action: 'enter', targets: ['bucket'] },
          { at: { type: 'beat', edge: 'end', offsetSec: -0.5 }, action: 'dim', targets: ['api'] },
        ],
      },
      {
        beatId: 'bucket-empty',
        kind: 'board',
        layoutMode: 'two_column',
        elements: [{ id: 'empty', primitive: 'counter', props: { value: 0 } }],
        events: [
          {
            at: { type: 'word_text', text: 'no', occurrence: 2 },
            action: 'pulse',
            targets: ['empty'],
          },
        ],
      },
    ],
    timing: {
      audioFile: 'runs/1/audio/narration.wav',
      beats: [
        { beatId: 'hook', startSec: 0, endSec: 4, words: timedWords(10, 0) },
        { beatId: 'bucket-intro', startSec: 4.15, endSec: 7, words: timedWords(7, 4.15) },
        { beatId: 'bucket-empty', startSec: 7.15, endSec: 10, words: timedWords(8, 7.15) },
      ],
      events: [{ beatId: 'hook', eventIndex: 1, atSec: 3.1 }],
    },
  };
}

function timedWords(count: number, fromSec: number) {
  return Array.from({ length: count }, (_, i) => ({
    text: `w${i}`,
    startSec: fromSec + i * 0.3,
    endSec: fromSec + i * 0.3 + 0.25,
  }));
}
