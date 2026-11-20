import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ResearchNotesSchema } from './notes.ts';

describe('ResearchNotesSchema list caps', () => {
  it('caps the long lists, as maxItems in the output JSON Schema', () => {
    const schema = z.toJSONSchema(ResearchNotesSchema, { io: 'input' }) as {
      properties: Record<string, { maxItems?: number }>;
    };
    const caps = Object.fromEntries(
      ['facts', 'numbers', 'failureModes', 'openQuestions'].map((key) => [
        key,
        schema.properties[key]?.maxItems,
      ]),
    );
    expect(caps).toEqual({ facts: 40, numbers: 30, failureModes: 10, openQuestions: 10 });
  });

  it('rejects a list over its cap', () => {
    const question = {
      question: 'What is not covered?',
      reason: 'not_covered',
      sourceChunkIds: [],
    };
    const result = ResearchNotesSchema.shape.openQuestions.safeParse(Array(11).fill(question));
    expect(result.success).toBe(false);
    expect(
      ResearchNotesSchema.shape.openQuestions.safeParse(Array(10).fill(question)).success,
    ).toBe(true);
  });
});
