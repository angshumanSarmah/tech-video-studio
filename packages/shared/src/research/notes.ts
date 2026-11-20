import { z } from 'zod';
import { SOURCE_CHUNK_ID_PATTERN } from '../domain/sources.ts';

/**
 * The Researcher's output (P1C.3): cited notes every later agent works from. Every item cites
 * the source chunks it comes from, so a gate-1 reviewer and the deterministic checks
 * (`researchNotesProblems`) can trace each claim. Descriptions reach the model through the
 * output JSON Schema, so they are written to it.
 */

export const SourceChunkIdSchema = z
  .string()
  .regex(SOURCE_CHUNK_ID_PATTERN, 'A chunk id from the sources, e.g. "source-1#chunk-2".');

const ChunkIdsSchema = z
  .array(SourceChunkIdSchema)
  .min(1)
  .max(8)
  .describe('Ids of the source chunks that state this. Use only chunk ids from the input.');

const text = (max: number, description: string) =>
  z.string().trim().min(1).max(max).describe(description);

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const ResearchConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export type ResearchConfidence = z.infer<typeof ResearchConfidenceSchema>;

/** `fact-<n>`: a slug, so the Story layer's `factIds` and stat card `sourceRef`s can point here. */
export const ResearchFactIdSchema = z.string().regex(/^fact-[1-9]\d*$/, 'Use "fact-<n>".');
/** `num-<n>`, in the same id space as facts (stat cards cite either). */
export const ResearchNumberIdSchema = z.string().regex(/^num-[1-9]\d*$/, 'Use "num-<n>".');

export const ResearchMechanismStepSchema = z.strictObject({
  text: text(240, 'One step of what happens, in order.'),
  sourceChunkIds: ChunkIdsSchema,
});

export const ResearchMechanismSchema = z.strictObject({
  summary: text(600, 'How the thing does its main job, in two to four sentences.'),
  sourceChunkIds: ChunkIdsSchema,
  steps: z.array(ResearchMechanismStepSchema).min(1).max(10),
});

export const ResearchFactSchema = z.strictObject({
  id: ResearchFactIdSchema,
  statement: text(300, 'One claim the sources state.'),
  sourceChunkIds: ChunkIdsSchema,
  confidence: ResearchConfidenceSchema.describe('low when one weak source supports it.'),
});
export type ResearchFact = z.infer<typeof ResearchFactSchema>;

export const ResearchNumberSchema = z.strictObject({
  id: ResearchNumberIdSchema,
  value: text(
    40,
    'The number exactly as the cited chunk writes it (digits, separators and words as written), never rounded or converted.',
  ),
  unit: z
    .string()
    .trim()
    .max(40)
    .describe('Unit as the source gives it, e.g. "ms", "requests per second"; "" when none.'),
  context: text(200, 'What the number measures, and under which conditions.'),
  sourceChunkId: SourceChunkIdSchema.describe('The one chunk that states this number.'),
  asOf: text(
    40,
    'The date the source gives for the number, as written; omit when none.',
  ).optional(),
});
export type ResearchNumber = z.infer<typeof ResearchNumberSchema>;

export const ResearchTradeOffSchema = z.strictObject({
  choice: text(160, 'The design choice.'),
  gains: text(240, 'What the choice buys.'),
  costs: text(240, 'What it gives up.'),
  sourceChunkIds: ChunkIdsSchema,
});

export const ResearchRejectedAlternativeSchema = z.strictObject({
  alternative: text(160, 'A design the sources consider and reject.'),
  reason: text(300, 'Why it was rejected, as the sources say.'),
  sourceChunkIds: ChunkIdsSchema,
});

export const ResearchMisconceptionSchema = z.strictObject({
  belief: text(200, 'What engineers commonly believe.'),
  correction: text(300, 'What is actually true, per the sources.'),
  sourceChunkIds: ChunkIdsSchema,
});

export const FAILURE_MODE_KINDS = ['edge_case', 'failure_mode', 'incident'] as const;

export const ResearchFailureModeSchema = z.strictObject({
  kind: z.enum(FAILURE_MODE_KINDS),
  description: text(600, 'What breaks, when, and what it costs.'),
  /** Real incidents only: date and publisher as the source writes them. */
  incident: z
    .strictObject({
      date: text(40, 'As the source writes it.').optional(),
      publisher: text(80, 'Who published the report.').optional(),
    })
    .optional()
    .describe('For kind "incident": when it happened and who reported it.'),
  sourceChunkIds: ChunkIdsSchema,
});

export const ResearchAnalogySchema = z.strictObject({
  analogy: text(200, 'An everyday situation that works like the mechanism.'),
  matches: text(240, 'Which part of the mechanism it matches, and how.'),
  breaksDown: text(240, 'Where the analogy stops matching the real system.'),
});

export const ResearchGlossaryEntrySchema = z.strictObject({
  term: text(60, 'A key term of the topic, as the sources write it.'),
  plainMeaning: text(200, 'What it means, in one plain line for someone new to the topic.'),
  sourceChunkIds: ChunkIdsSchema,
});

export const ResearchHookSchema = z.strictObject({
  situation: text(200, "An engineer's concrete problem with a real number from the sources."),
  sourceChunkIds: ChunkIdsSchema,
});

export const OPEN_QUESTION_REASONS = ['disagreement', 'not_covered'] as const;

export const ResearchOpenQuestionSchema = z.strictObject({
  question: text(300, 'What the sources disagree on or do not cover.'),
  reason: z.enum(OPEN_QUESTION_REASONS),
  sourceChunkIds: z
    .array(SourceChunkIdSchema)
    .max(8)
    .describe('The chunks that disagree; empty when the sources are silent.'),
});

export const ResearchNotesSchema = z.strictObject({
  mechanism: ResearchMechanismSchema,
  plainSummary: text(
    600,
    'The mechanism in plain words, as you would tell a smart friend new to the topic. Use only numbers already listed in "numbers".',
  ),
  analogies: z.array(ResearchAnalogySchema).min(1).max(2),
  glossary: z.array(ResearchGlossaryEntrySchema).min(1).max(12),
  facts: z.array(ResearchFactSchema).min(1).max(40),
  numbers: z.array(ResearchNumberSchema).max(30),
  tradeOffs: z.array(ResearchTradeOffSchema).max(12),
  rejectedAlternatives: z.array(ResearchRejectedAlternativeSchema).max(12),
  misconceptions: z.array(ResearchMisconceptionSchema).max(12),
  failureModes: z.array(ResearchFailureModeSchema).max(10),
  hooks: z.array(ResearchHookSchema).min(2).max(4),
  openQuestions: z.array(ResearchOpenQuestionSchema).max(10),
});
export type ResearchNotes = z.infer<typeof ResearchNotesSchema>;
