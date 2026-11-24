import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assembleScriptedSpec,
  DirectorPlanSchema,
  ResearchNotesSchema,
  ScriptwriterOutputSchema,
  type DirectorPlan,
  type ResearchNotes,
  type ScriptwriterOutput,
  type VideoSpecInput,
} from '@explainer-studio/shared';
import type { DryRunResponse } from '#worker/llm/index.ts';
import { fixtureResponsesDir, fixtureTopic, type FixtureTopicId } from '../fixture-topics.ts';

/**
 * Test and script helpers for the Generator: the recorded Director and Scriptwriter answers of a
 * fixture topic, assembled into the spec the Generator works on. Not imported by any entrypoint.
 */

/** The accepted (last) recorded answer of a role for a fixture topic. */
function recordedAnswer(
  role: 'researcher' | 'director' | 'scriptwriter',
  topic: FixtureTopicId,
): unknown {
  const file = join(fixtureResponsesDir(role, topic), `${role}.json`);
  const responses = JSON.parse(readFileSync(file, 'utf8')) as DryRunResponse[];
  const content = responses.at(-1)?.content;
  if (!content) throw new Error(`No recorded ${role} answer for ${topic}.`);
  return JSON.parse(content) as unknown;
}

export function recordedNotes(topic: FixtureTopicId): ResearchNotes {
  return ResearchNotesSchema.parse(recordedAnswer('researcher', topic));
}

export function recordedPlan(topic: FixtureTopicId): DirectorPlan {
  return DirectorPlanSchema.parse(recordedAnswer('director', topic));
}

export function recordedScript(topic: FixtureTopicId): ScriptwriterOutput {
  return ScriptwriterOutputSchema.parse(recordedAnswer('scriptwriter', topic));
}

/** The fixture topic's plan and script as one spec (before TTS), as P1C.9 saves it. */
export function fixtureScriptedSpec(topic: FixtureTopicId): VideoSpecInput {
  return assembleScriptedSpec(recordedPlan(topic), recordedScript(topic).script, {
    id: `fixture-${topic}`,
    series: fixtureTopic(topic).seriesTag,
    seriesNumber: 1,
  });
}

const word = (index: number) => ({ type: 'word', index }) as const;

/**
 * Hand-written boards for the fixture topics, as the model would write them: clean (every check
 * passes), with the script's tags and stat cards placed. Loosely typed so tests can seed faults.
 */
export type FixtureBoard = {
  elements: { id: string; primitive: string; props: Record<string, unknown>; zone?: string }[];
  events: { at: { type: 'word'; index: number }; action: string; targets: string[] }[];
  focus: string[];
};

/** A clean board for the hook (beat1, two_column): the script's tags and stat card placed. */
export function hookBoard(): FixtureBoard {
  const source = fixtureScriptedSpec('rate-limiter').script?.[0]?.source ?? '';
  return {
    elements: [
      {
        id: 'shop',
        primitive: 'node_card',
        props: { title: 'Checkout', icon: 'shopping_bag' },
        zone: 'left',
      },
      {
        id: 'limiter',
        primitive: 'node_card',
        props: { title: 'Rate limiter', icon: 'shield' },
        zone: 'right',
      },
      {
        id: 'errors',
        primitive: 'tag',
        props: { text: 'Checkout errors', semantic: 'problem', pin: { to: 'shop', side: 'top' } },
      },
      {
        id: 'traffic',
        primitive: 'tag',
        props: {
          text: 'Too much traffic',
          semantic: 'problem',
          pin: { to: 'shop', side: 'bottom' },
        },
      },
      {
        id: 'failed',
        primitive: 'stat_card',
        props: { value: '31%', label: 'checkouts failed', source },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(0), action: 'enter', targets: ['failed'] },
      { at: word(5), action: 'enter', targets: ['shop'] },
      { at: word(6), action: 'enter', targets: ['errors'] },
      { at: word(11), action: 'enter', targets: ['traffic'] },
      { at: word(16), action: 'enter', targets: ['limiter'] },
      { at: word(17), action: 'highlight', targets: ['limiter'] },
    ],
    focus: ['limiter'],
  };
}

/** A clean first board for beat3 (versus_split) and a clean continuation for beat4. */
export function storeBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'own',
        primitive: 'node_card',
        props: { title: 'Own bucket', icon: 'server' },
        zone: 'left',
      },
      {
        id: 'shared',
        primitive: 'node_card',
        props: { title: 'Shared store', icon: 'database' },
        zone: 'right',
      },
      {
        id: 'one',
        primitive: 'tag',
        props: { text: 'One bucket', semantic: 'ok', pin: { to: 'shared', side: 'top' } },
      },
      {
        id: 'agree',
        primitive: 'tag',
        props: { text: 'All nodes agree', semantic: 'ok', pin: { to: 'shared', side: 'bottom' } },
      },
    ],
    events: [
      { at: word(5), action: 'enter', targets: ['own'] },
      { at: word(24), action: 'enter', targets: ['shared'] },
      { at: word(25), action: 'enter', targets: ['one'] },
      { at: word(28), action: 'enter', targets: ['agree'] },
    ],
    focus: ['shared'],
  };
}

export function countBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'count',
        primitive: 'tag',
        props: { text: 'Shared count', semantic: 'focus', pin: { to: 'own', side: 'top' } },
      },
      {
        id: 'double',
        primitive: 'tag',
        props: { text: 'Double admit', semantic: 'problem', pin: { to: 'own', side: 'bottom' } },
      },
    ],
    events: [
      { at: word(5), action: 'enter', targets: ['count'] },
      { at: word(26), action: 'enter', targets: ['double'] },
      { at: word(26), action: 'reject', targets: ['own'] },
    ],
    focus: ['own'],
  };
}

/** A clean first board for the tokenizer's b2 (versus_split), the board b3 zooms from. */
export function versusBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'chars',
        primitive: 'node_card',
        props: { title: 'Characters', icon: 'list' },
        zone: 'left',
      },
      {
        id: 'words',
        primitive: 'node_card',
        props: { title: 'Whole words', icon: 'book' },
        zone: 'right',
      },
      {
        id: 'pieces',
        primitive: 'node_card',
        props: { title: 'Subword pieces', icon: 'layers' },
        zone: 'shared',
      },
      {
        id: 'tag-chars',
        primitive: 'tag',
        props: { text: 'characters', pin: { to: 'chars', side: 'top' } },
      },
      {
        id: 'tag-words',
        primitive: 'tag',
        props: { text: 'whole words', pin: { to: 'words', side: 'top' } },
      },
      {
        id: 'tag-pieces',
        primitive: 'tag',
        props: { text: 'subwords', semantic: 'focus', pin: { to: 'pieces', side: 'top' } },
      },
    ],
    events: [
      { at: word(0), action: 'enter', targets: ['chars', 'tag-chars'] },
      { at: word(16), action: 'enter', targets: ['words', 'tag-words'] },
      { at: word(23), action: 'enter', targets: ['pieces', 'tag-pieces'] },
      { at: word(29), action: 'highlight', targets: ['pieces'] },
    ],
    focus: ['pieces'],
  };
}

const scriptSource = (beatIndex: number) =>
  fixtureScriptedSpec('rate-limiter').script?.[beatIndex]?.source ?? '';

/** beat2 (centered_focus, example numbers): a request's key and its token bucket. */
export function bucketBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'key',
        primitive: 'node_card',
        props: { title: 'Request key', icon: 'key' },
        zone: 'around',
      },
      {
        id: 'bucket',
        primitive: 'node_card',
        props: { title: 'Token bucket', icon: 'database' },
        zone: 'center',
      },
      {
        id: 'allowance',
        primitive: 'tag',
        props: { text: 'Allowance per key', semantic: 'ok', pin: { to: 'bucket', side: 'top' } },
      },
      {
        id: 'spend',
        primitive: 'tag',
        props: { text: 'One token per request', pin: { to: 'bucket', side: 'bottom' } },
      },
    ],
    events: [
      { at: word(3), action: 'enter', targets: ['key'] },
      { at: word(11), action: 'enter', targets: ['bucket'] },
      { at: word(14), action: 'enter', targets: ['allowance'] },
      { at: word(27), action: 'enter', targets: ['spend'] },
      { at: word(29), action: 'pulse', targets: ['bucket'] },
    ],
    focus: ['bucket'],
  };
}

/** beat5 (stacked_list): every check pays a network trip to the store. */
export function tripBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'node',
        primitive: 'node_card',
        props: { title: 'Gateway node', icon: 'server' },
        zone: 'row',
      },
      {
        id: 'store',
        primitive: 'node_card',
        props: { title: 'Shared store', icon: 'database' },
        zone: 'row',
      },
      {
        id: 'trip',
        primitive: 'connector',
        props: { from: 'node', to: 'store', label: 'Network trip' },
      },
      {
        id: 'hop',
        primitive: 'tag',
        props: { text: 'Network hop', pin: { to: 'store', side: 'right' } },
      },
      {
        id: 'every',
        primitive: 'tag',
        props: { text: 'Every request', pin: { to: 'node', side: 'right' } },
      },
      {
        id: 'p99',
        primitive: 'stat_card',
        props: { value: '2.1 ms', label: 'p99 store round trip', source: scriptSource(4) },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(4), action: 'enter', targets: ['store'] },
      { at: word(9), action: 'enter', targets: ['node', 'every'] },
      { at: word(12), action: 'enter', targets: ['trip', 'hop'] },
      { at: word(23), action: 'enter', targets: ['p99'] },
    ],
    focus: ['trip'],
  };
}

/** beat6 (centered_focus): the failover moves the store and calls pass the timeout. */
export function failoverBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'replica',
        primitive: 'node_card',
        props: { title: 'Store replica', icon: 'database' },
        zone: 'center',
      },
      {
        id: 'limiter',
        primitive: 'node_card',
        props: { title: 'Rate limiter', icon: 'shield' },
        zone: 'around',
      },
      {
        id: 'call',
        primitive: 'connector',
        props: { from: 'limiter', to: 'replica' },
      },
      {
        id: 'move',
        primitive: 'tag',
        props: { text: 'Cross-zone move', pin: { to: 'replica', side: 'top' } },
      },
      {
        id: 'tripped',
        primitive: 'tag',
        props: {
          text: 'Timeout tripped',
          semantic: 'problem',
          pin: { to: 'replica', side: 'bottom' },
        },
      },
      {
        id: 'slow',
        primitive: 'stat_card',
        props: { value: '80 ms', label: 'store call after failover', source: scriptSource(5) },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(3), action: 'enter', targets: ['limiter', 'replica', 'call'] },
      { at: word(12), action: 'enter', targets: ['move'] },
      { at: word(22), action: 'enter', targets: ['slow'] },
      { at: word(27), action: 'enter', targets: ['tripped'] },
      { at: word(34), action: 'reject', targets: ['replica'] },
    ],
    focus: ['replica'],
  };
}

/** beat7 (hub_spoke): fail open, every instance limits on its own, the provider floods. */
export function failOpenBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'provider',
        primitive: 'node_card',
        props: { title: 'Payment provider', icon: 'credit_card' },
        zone: 'hub',
      },
      {
        id: 'inst-a',
        primitive: 'node_card',
        props: { title: 'Instance A', icon: 'server' },
        zone: 'spoke',
      },
      {
        id: 'inst-b',
        primitive: 'node_card',
        props: { title: 'Instance B', icon: 'server' },
        zone: 'spoke',
      },
      { id: 'a-provider', primitive: 'connector', props: { from: 'inst-a', to: 'provider' } },
      { id: 'b-provider', primitive: 'connector', props: { from: 'inst-b', to: 'provider' } },
      {
        id: 'open',
        primitive: 'tag',
        props: { text: 'Fail open', semantic: 'problem', pin: { to: 'inst-a', side: 'top' } },
      },
      {
        id: 'local',
        primitive: 'tag',
        props: { text: 'Local limits', pin: { to: 'inst-b', side: 'top' } },
      },
    ],
    events: [
      { at: word(2), action: 'enter', targets: ['inst-a', 'inst-b'] },
      { at: word(6), action: 'enter', targets: ['open'] },
      { at: word(16), action: 'enter', targets: ['local'] },
      { at: word(21), action: 'enter', targets: ['provider', 'a-provider', 'b-provider'] },
      { at: word(33), action: 'reject', targets: ['provider'] },
    ],
    focus: ['provider'],
  };
}

/** beat8 (grid, the final beat): the three fixes; nothing in the last sentence. */
export function fixBoard(): FixtureBoard {
  return {
    elements: [
      {
        id: 'closed',
        primitive: 'node_card',
        props: { title: 'Provider limiter', icon: 'shield_check' },
        zone: 'cell',
      },
      {
        id: 'fallback',
        primitive: 'node_card',
        props: { title: 'Fallback limits', icon: 'server' },
        zone: 'cell',
      },
      {
        id: 'timeout',
        primitive: 'node_card',
        props: { title: 'Store timeout', icon: 'clock' },
        zone: 'cell',
      },
      {
        id: 'fail-closed',
        primitive: 'tag',
        props: { text: 'Fail closed', semantic: 'ok', pin: { to: 'closed', side: 'top' } },
      },
      {
        id: 'split',
        primitive: 'tag',
        props: { text: 'Split fallback', semantic: 'ok', pin: { to: 'fallback', side: 'top' } },
      },
      {
        id: 'raised',
        primitive: 'stat_card',
        props: { value: '150 ms', label: 'store timeout after fix', source: scriptSource(7) },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(1), action: 'enter', targets: ['closed'] },
      { at: word(3), action: 'enter', targets: ['fail-closed'] },
      { at: word(10), action: 'enter', targets: ['fallback'] },
      { at: word(12), action: 'enter', targets: ['split'] },
      { at: word(23), action: 'enter', targets: ['timeout'] },
      { at: word(28), action: 'enter', targets: ['raised'] },
    ],
    focus: ['closed'],
  };
}

/** Every rate-limiter beat's hand-written board, by beat id (the Generator's dry-run answers). */
export function rateLimiterBoards(): Record<string, FixtureBoard> {
  return {
    beat1: hookBoard(),
    beat2: bucketBoard(),
    beat3: storeBoard(),
    beat4: countBoard(),
    beat5: tripBoard(),
    beat6: failoverBoard(),
    beat7: failOpenBoard(),
    beat8: fixBoard(),
  };
}
