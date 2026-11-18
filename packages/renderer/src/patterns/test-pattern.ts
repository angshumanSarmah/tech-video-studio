import { EventAnchorSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { definePattern } from './types.ts';

/**
 * Test-only pattern that proves the pattern shape until P1A.8 registers real ones: a second
 * request bounces off a held label. Not registered; tests pass it to `buildPatternRegistry`.
 */
export const bouncePattern = definePattern({
  id: 'test_bounce',
  family: 'flow',
  paramsSchema: z.strictObject({
    label: z.string().min(1).max(24).describe('What the first request holds.'),
    at: z.strictObject({ bounce: EventAnchorSchema }),
  }),
  actions: ['enter', 'exit', 'dim'],
  anchors: [{ name: 'bounce', description: 'The word where the second request is turned away.' }],
  description: {
    summary: 'A held label; a second request arrives and is rejected.',
    whenToUse: 'Tests only: proves that patterns expand into primitives and events.',
    whenNotToUse: 'Anywhere in a real spec.',
  },
  example: { params: { label: '<example-label>', at: { bounce: { type: 'word', index: 0 } } } },
  expand: (params) => ({
    elements: [
      { id: 'held', primitive: 'tag', props: { text: params.label, semantic: 'focus' } },
      { id: 'second', primitive: 'tag', props: { text: params.label } },
    ],
    events: [
      { at: params.at.bounce, action: 'enter', targets: ['second'] },
      { at: params.at.bounce, action: 'reject', targets: ['second'] },
    ],
  }),
});
