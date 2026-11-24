import { join } from 'node:path';
import { generatorCatalogueBlock } from '@explainer-studio/renderer/catalog';
import { SettingsSchema, validateVideoSpec } from '@explainer-studio/shared';
import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from '#core/workspace-root.ts';
import { FIXTURE_TOPIC_IDS, type FixtureTopicId } from '../fixture-topics.ts';
import { buildPrompt } from '../prompt-builder.ts';
import { loadPromptTemplates, PROMPTS_DIR } from '../prompts/templates.ts';
import { generatorUserMessage } from './input.ts';
import { fixtureScriptedSpec, recordedNotes } from './testing.ts';

const templates = loadPromptTemplates(join(findWorkspaceRoot(import.meta.dirname), PROMPTS_DIR));
const variables = SettingsSchema.parse({}).video;
const catalogue = generatorCatalogueBlock();

/** The fixture topic's spec, validated (defaults filled), as the job reads it. */
function specOf(topic: FixtureTopicId) {
  const result = validateVideoSpec(fixtureScriptedSpec(topic));
  if (!result.spec) throw new Error(`the ${topic} fixture spec is invalid`);
  return result.spec;
}

/** Every beat's real prompt: the Generator's user message, before any board exists. */
const prompts = FIXTURE_TOPIC_IDS.flatMap((topic) => {
  const spec = specOf(topic);
  const notes = recordedNotes(topic);
  return spec.story.beats.map((beat, beatIndex) => ({
    topic,
    beatId: beat.id,
    prompt: buildPrompt(templates, {
      role: 'generator',
      variables,
      catalogue,
      input: generatorUserMessage({ spec, scenes: [], beatIndex, notes }),
    }),
  }));
});

const system = (p: (typeof prompts)[number]) => p.prompt.messages[0]?.content ?? '';
const user = (p: (typeof prompts)[number]) => p.prompt.messages[1]?.content ?? '';

describe('the fixture topics as the Generator gets them', () => {
  it.each(FIXTURE_TOPIC_IDS)('%s: plan and script assemble into a valid spec', (topic) => {
    const result = validateVideoSpec(fixtureScriptedSpec(topic));
    expect(result.errors).toEqual([]);
  });
});

describe('the Generator prompt prefix', () => {
  it('is byte-identical for every beat of both fixture topics', () => {
    expect(prompts.length).toBeGreaterThan(10);
    const first = system(prompts[0] ?? prompts[1]!);
    for (const p of prompts)
      expect({ beat: `${p.topic}/${p.beatId}`, same: system(p) === first }).toEqual({
        beat: `${p.topic}/${p.beatId}`,
        same: true,
      });
  });

  it('carries the catalogue block and the output schema, and nothing of any beat', () => {
    const prefix = system(prompts[0]!);
    expect(prefix).toContain(catalogue);
    expect(prefix).toContain('## OUTPUT SHAPE');
    for (const p of prompts) expect(prefix).not.toContain(user(p));
  });

  it('puts each beat in its own user message', () => {
    expect(new Set(prompts.map(user)).size).toBe(prompts.length);
  });
});
