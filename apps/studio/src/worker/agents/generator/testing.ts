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
