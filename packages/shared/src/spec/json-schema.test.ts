import { describe, expect, it } from 'vitest';
import { LLM_SPEC_PARTS, llmJsonSchema } from './json-schema.ts';

/** Property names that would mean the LLM is placing things (architecture rule 2). */
const PLACEMENT_KEYS = /^(x|y|z|left|top|right|bottom|width|height|size|position|coords?|scale)$/i;

function propertyNames(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(propertyNames);
  if (typeof node !== 'object' || node === null) return [];
  const record = node as Record<string, unknown>;
  const own =
    typeof record.properties === 'object' && record.properties !== null
      ? Object.keys(record.properties)
      : [];
  return [...own, ...Object.values(record).flatMap(propertyNames)];
}

describe('llmJsonSchema', () => {
  it.each(LLM_SPEC_PARTS)('%s has no coordinate or size fields', (part) => {
    const names = propertyNames(llmJsonSchema(part));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => PLACEMENT_KEYS.test(n))).toEqual([]);
  });

  it('closes objects and makes defaulted fields optional', () => {
    const scene = llmJsonSchema('scene') as {
      additionalProperties: unknown;
      required: string[];
    };
    expect(scene.additionalProperties).toBe(false);
    expect(scene.required).toEqual(expect.arrayContaining(['beatId', 'kind', 'layoutMode']));
    expect(scene.required).not.toContain('events');
  });

  it('includes the Director fields in the story schema', () => {
    const story = llmJsonSchema('story') as { properties: Record<string, unknown> };
    expect(Object.keys(story.properties)).toEqual(
      expect.arrayContaining([
        'plantedQuestion',
        'rejectedAlternative',
        'ending',
        'missingPrimitiveRequests',
        'metaphorWorld',
      ]),
    );
  });
});
