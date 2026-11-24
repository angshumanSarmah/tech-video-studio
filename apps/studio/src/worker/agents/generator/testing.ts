import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assembleScriptedSpec,
  DirectorPlanSchema,
  generatorScene,
  GeneratorOutputSchema,
  ResearchNotesSchema,
  ScriptwriterOutputSchema,
  TimingSettingsSchema,
  validateRenderableVideoSpec,
  validateVideoSpec,
  type GeneratorOutput,
  type RenderableVideoSpec,
  type DirectorPlan,
  type ResearchNotes,
  type ScriptwriterOutput,
  type VideoSpecInput,
} from '@explainer-studio/shared';
import type { DryRunResponse } from '#worker/llm/index.ts';
import { fixtureResponsesDir, fixtureTopic, type FixtureTopicId } from '../fixture-topics.ts';
import { loadTimingFixture, withFixtureTiming } from './timing-fixture.ts';

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

/** The Generator's accepted (last) recorded board for each beat of a fixture topic. */
export function recordedBoards(topic: FixtureTopicId): Record<string, GeneratorOutput> {
  const file = join(fixtureResponsesDir('generator', topic), 'generator.json');
  const byBeat = JSON.parse(readFileSync(file, 'utf8')) as Record<string, DryRunResponse[]>;
  return Object.fromEntries(
    Object.entries(byBeat).map(([beatId, responses]) => {
      const content = responses.at(-1)?.content;
      if (!content) throw new Error(`No recorded generator answer for ${topic} ${beatId}.`);
      return [beatId, GeneratorOutputSchema.parse(JSON.parse(content))];
    }),
  );
}

/**
 * The fixture topic as the Curator sees it: the recorded plan and script, timed with the
 * committed timing fixture at the default pauses, and every recorded board. Throws when the
 * pieces no longer fit together (re-record or re-time).
 */
export function fixtureGeneratedSpec(topic: FixtureTopicId): RenderableVideoSpec {
  const scripted = validateVideoSpec(fixtureScriptedSpec(topic)).spec;
  if (!scripted) throw new Error(`The ${topic} plan and script do not assemble into a spec.`);
  const timed = withFixtureTiming(
    scripted,
    loadTimingFixture(topic),
    TimingSettingsSchema.parse({}),
  );
  const boards = recordedBoards(topic);
  const scenes = timed.story.beats.map((beat) => {
    const board = boards[beat.id];
    if (!board) throw new Error(`No recorded board for ${topic} ${beat.id}.`);
    return generatorScene(board, beat);
  });
  const result = validateRenderableVideoSpec({ ...timed, scenes });
  if (!result.ok) throw new Error(`The ${topic} boards do not make a valid spec.`);
  return result.spec;
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
const scriptSource = (beatIndex: number) =>
  fixtureScriptedSpec('rate-limiter').script?.[beatIndex]?.source ?? '';

const node = (
  id: string,
  title: string,
  icon: string,
  zone?: string,
): FixtureBoard['elements'][number] => ({
  id,
  primitive: 'node_card',
  props: { title, icon },
  ...(zone ? { zone } : {}),
});

const tag = (
  id: string,
  text: string,
  pin: { to: string; side: string },
  semantic = 'neutral',
): FixtureBoard['elements'][number] => ({
  id,
  primitive: 'tag',
  props: { text, semantic, pin },
});

/** beat1 (two_column): checkout failing, the rate limiter, the 31% stat card. */
export function hookBoard(): FixtureBoard {
  return {
    elements: [
      node('shop', 'Checkout', 'shopping_bag', 'left'),
      node('limiter', 'Rate limiter', 'shield', 'right'),
      tag('errors', 'checkout failing', { to: 'shop', side: 'top' }, 'problem'),
      tag('traffic', 'too much traffic', { to: 'limiter', side: 'bottom' }, 'problem'),
      {
        id: 'failed',
        primitive: 'stat_card',
        props: { value: '31%', label: 'Checkouts that failed', source: scriptSource(0) },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(6), action: 'enter', targets: ['shop'] },
      { at: word(7), action: 'enter', targets: ['errors'] },
      { at: word(12), action: 'enter', targets: ['limiter'] },
      { at: word(17), action: 'enter', targets: ['traffic'] },
      { at: word(20), action: 'enter', targets: ['failed'] },
    ],
    focus: ['limiter'],
  };
}

/** beat2 (centered_focus, example numbers): a request's key and its token bucket. */
export function bucketBoard(): FixtureBoard {
  return {
    elements: [
      node('key', 'Request key', 'key', 'around'),
      node('bucket', 'Token bucket', 'database', 'center'),
      tag('allowance', 'per-key bucket', { to: 'bucket', side: 'top' }, 'ok'),
      tag('spend', 'spend one token', { to: 'bucket', side: 'bottom' }),
    ],
    events: [
      { at: word(5), action: 'enter', targets: ['key'] },
      { at: word(8), action: 'enter', targets: ['bucket'] },
      { at: word(9), action: 'enter', targets: ['allowance'] },
      { at: word(26), action: 'enter', targets: ['spend'] },
      { at: word(28), action: 'pulse', targets: ['bucket'] },
    ],
    focus: ['bucket'],
  };
}

/** beat3 (versus_split): a bucket on each node against one shared store; beat4 continues it. */
export function storeBoard(): FixtureBoard {
  return {
    elements: [
      node('own', 'Own bucket', 'server', 'left'),
      node('shared', 'Shared store', 'database', 'right'),
      tag('one', 'bucket per node', { to: 'own', side: 'top' }, 'problem'),
      tag('agree', 'shared store', { to: 'shared', side: 'top' }, 'ok'),
    ],
    events: [
      { at: word(6), action: 'enter', targets: ['own'] },
      { at: word(8), action: 'enter', targets: ['one'] },
      { at: word(23), action: 'enter', targets: ['shared'] },
      { at: word(24), action: 'enter', targets: ['agree'] },
    ],
    focus: ['shared'],
  };
}

/** beat4, continuing beat3's board: its one tag, and both nodes spending the same token. */
export function countBoard(): FixtureBoard {
  return {
    elements: [tag('double', 'double spend', { to: 'own', side: 'bottom' }, 'problem')],
    events: [
      { at: word(14), action: 'enter', targets: ['double'] },
      { at: word(25), action: 'reject', targets: ['own'] },
    ],
    focus: ['own'],
  };
}

/** beat5 (stacked_list): every check crosses the network to the store. */
export function tripBoard(): FixtureBoard {
  return {
    elements: [
      node('node', 'Gateway node', 'server', 'row'),
      node('store', 'Shared store', 'database', 'row'),
      { id: 'trip', primitive: 'connector', props: { from: 'node', to: 'store' } },
      tag('hop', 'network round trip', { to: 'trip', side: 'middle' }),
      tag('slow', 'slow store', { to: 'store', side: 'bottom' }, 'problem'),
    ],
    events: [
      { at: word(2), action: 'enter', targets: ['node'] },
      { at: word(5), action: 'enter', targets: ['store', 'trip'] },
      { at: word(6), action: 'enter', targets: ['hop'] },
      { at: word(11), action: 'enter', targets: ['slow'] },
      { at: word(16), action: 'pulse', targets: ['trip'] },
    ],
    focus: ['trip'],
  };
}

/** beat6 (centered_focus): the failover moves the store and calls pass the timeout. */
export function failoverBoard(): FixtureBoard {
  return {
    elements: [
      node('replica', 'Store replica', 'database', 'center'),
      node('limiter', 'Rate limiter', 'shield', 'around'),
      { id: 'call', primitive: 'connector', props: { from: 'limiter', to: 'replica' } },
      tag('move', 'cross-zone replica', { to: 'replica', side: 'top' }),
      tag('tripped', 'past the timeout', { to: 'replica', side: 'bottom' }, 'problem'),
      {
        id: 'slow',
        primitive: 'stat_card',
        props: { value: '80 ms', label: 'Store call after failover', source: scriptSource(5) },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(3), action: 'enter', targets: ['limiter', 'replica', 'call'] },
      { at: word(9), action: 'enter', targets: ['move'] },
      { at: word(20), action: 'enter', targets: ['slow'] },
      { at: word(25), action: 'enter', targets: ['tripped'] },
      { at: word(34), action: 'reject', targets: ['replica'] },
    ],
    focus: ['replica'],
  };
}

/** beat7 (hub_spoke): requests go uncounted, every instance limits alone, the provider floods. */
export function failOpenBoard(): FixtureBoard {
  return {
    elements: [
      node('provider', 'Payment provider', 'credit_card', 'hub'),
      node('inst-a', 'Instance A', 'server', 'spoke'),
      node('inst-b', 'Instance B', 'server', 'spoke'),
      { id: 'a-provider', primitive: 'connector', props: { from: 'inst-a', to: 'provider' } },
      { id: 'b-provider', primitive: 'connector', props: { from: 'inst-b', to: 'provider' } },
      tag('open', 'uncounted traffic', { to: 'inst-a', side: 'top' }, 'problem'),
      tag('local', 'local limits', { to: 'inst-b', side: 'top' }),
    ],
    events: [
      { at: word(6), action: 'enter', targets: ['inst-a', 'inst-b'] },
      { at: word(10), action: 'enter', targets: ['open'] },
      { at: word(19), action: 'enter', targets: ['local'] },
      { at: word(24), action: 'enter', targets: ['provider', 'a-provider', 'b-provider'] },
      { at: word(35), action: 'reject', targets: ['provider'] },
    ],
    focus: ['provider'],
  };
}

/** beat8 (grid, the final beat): the three fixes; nothing in the last sentence. */
export function fixBoard(): FixtureBoard {
  return {
    elements: [
      node('closed', 'Payment limiter', 'shield_check', 'cell'),
      node('fallback', 'Fallback limits', 'server', 'cell'),
      node('timeout', 'Store timeout', 'clock', 'cell'),
      tag('fail-closed', 'refuse uncounted', { to: 'closed', side: 'top' }, 'ok'),
      tag('split', 'split fallback', { to: 'fallback', side: 'top' }, 'ok'),
      {
        id: 'raised',
        primitive: 'stat_card',
        props: { value: '150 ms', label: 'Store timeout after fix', source: scriptSource(7) },
        zone: 'aside',
      },
    ],
    events: [
      { at: word(2), action: 'enter', targets: ['closed'] },
      { at: word(4), action: 'enter', targets: ['fail-closed'] },
      { at: word(14), action: 'enter', targets: ['fallback'] },
      { at: word(17), action: 'enter', targets: ['split'] },
      { at: word(22), action: 'enter', targets: ['timeout'] },
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

/**
 * A clean first board for the tokenizer's b2 (versus_split), the board b3 zooms from. Word
 * indices count as `narrationWords` does (the narration's lone dashes are not words).
 */
export function versusBoard(): FixtureBoard {
  return {
    elements: [
      node('chars', 'Characters', 'list', 'left'),
      node('words', 'Whole words', 'book', 'right'),
      node('pieces', 'Subword pieces', 'layers', 'shared'),
      tag('tag-chars', 'single characters', { to: 'chars', side: 'top' }),
      tag('tag-words', 'whole words', { to: 'words', side: 'top' }),
      tag('tag-pieces', 'subword pieces', { to: 'pieces', side: 'top' }, 'focus'),
    ],
    events: [
      { at: word(6), action: 'enter', targets: ['chars', 'tag-chars'] },
      { at: word(22), action: 'enter', targets: ['words', 'tag-words'] },
      { at: word(30), action: 'enter', targets: ['pieces', 'tag-pieces'] },
      { at: word(31), action: 'highlight', targets: ['pieces'] },
    ],
    focus: ['pieces'],
  };
}
