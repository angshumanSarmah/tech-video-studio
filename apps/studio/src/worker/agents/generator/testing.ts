import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assembleScriptedSpec,
  DirectorPlanSchema,
  ScriptwriterOutputSchema,
  type DirectorPlan,
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
function recordedAnswer(role: 'director' | 'scriptwriter', topic: FixtureTopicId): unknown {
  const file = join(fixtureResponsesDir(role, topic), `${role}.json`);
  const responses = JSON.parse(readFileSync(file, 'utf8')) as DryRunResponse[];
  const content = responses.at(-1)?.content;
  if (!content) throw new Error(`No recorded ${role} answer for ${topic}.`);
  return JSON.parse(content) as unknown;
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
