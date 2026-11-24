import { z } from 'zod';
import type { ExplanationLevel } from '../config/video.ts';
import { CuratorOwnerSchema, IssueSeveritySchema, type CuratorOwner } from './issue.ts';

/**
 * The Curator's review (P1C.8 part 2): the model's answer, and what code decides about it. The
 * model reads text only (a code-written description of each board) and reports issues of a
 * closed set of categories, each quoting its evidence and naming the agent that would change it.
 * Code verifies every quote (`review-checks.ts`), and caps the severity by category and level
 * (`capSeverity`): the model may report less than the cap, never more. Descriptions reach the
 * model through the output JSON Schema.
 */

/** Issue categories (exhaustive), as the Curator prompt lists them. */
export const REVIEW_CATEGORIES = [
  'unsupported_claim',
  'wrong_simplification',
  'number_wrong_meaning',
  'visual_contradicts',
  'visual_distracts',
  'term_before_shown',
  'above_level',
  'hook_retold',
  'small_stat_card',
  'missing_trade_off',
] as const;
export const ReviewCategorySchema = z.enum(REVIEW_CATEGORIES);
export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

/** What a fix may change: the Scriptwriter's fields, the Generator's board, the Director's plan. */
export const FIX_FIELDS = [
  'narration',
  'headline',
  'tags',
  'stat_cards',
  'source',
  'board',
  'plan',
] as const;
export const FixFieldSchema = z.enum(FIX_FIELDS);
export type FixField = z.infer<typeof FixFieldSchema>;

/** The owner of each field: only that agent may be sent a fix to it. */
export const FIELD_OWNERS: Readonly<Record<FixField, CuratorOwner>> = {
  narration: 'scriptwriter',
  headline: 'scriptwriter',
  tags: 'scriptwriter',
  stat_cards: 'scriptwriter',
  source: 'scriptwriter',
  board: 'generator',
  plan: 'director',
};

const QuoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Copied exactly from the input, not paraphrased. Use "..." to leave words out.');

const ResearchIdSchema = z.string().trim().min(1).max(40);

/** Where an issue's evidence is: the words spoken, text shown, or the research involved. */
export const EvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('narration'), quote: QuoteSchema }),
  z.strictObject({ kind: z.literal('headline'), quote: QuoteSchema }),
  z.strictObject({ kind: z.literal('tag'), quote: QuoteSchema }),
  z.strictObject({ kind: z.literal('stat_card'), quote: QuoteSchema }),
  z.strictObject({ kind: z.literal('source'), quote: QuoteSchema }),
  z.strictObject({
    kind: z.literal('label'),
    elementId: z.string().trim().min(1).describe('The board element (its id in BOARD).'),
    quote: QuoteSchema.describe("One of that element's texts or values, copied exactly."),
  }),
  z.strictObject({
    kind: z.literal('fact'),
    id: ResearchIdSchema.describe('A "fact-<n>" id from the notes.'),
    quote: QuoteSchema.optional().describe('Words of that fact, when only part of it matters.'),
  }),
  z.strictObject({
    kind: z.literal('number'),
    id: ResearchIdSchema.describe('A "num-<n>" id from the notes.'),
  }),
  z.strictObject({
    kind: z.literal('note'),
    quote: QuoteSchema.describe(
      'Words of a trade-off, failure mode, misconception or open question in the notes.',
    ),
  }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceKind = Evidence['kind'];

export const CuratorIssueSchema = z.strictObject({
  beatId: z.string().trim().min(1).describe('The beat where the problem is (and is fixed).'),
  category: ReviewCategorySchema,
  severity: IssueSeveritySchema,
  owner: CuratorOwnerSchema.describe('The agent that would change the quoted text or board.'),
  fields: z
    .array(FixFieldSchema)
    .min(1)
    .max(3)
    .describe("What the fix may change; all of them the owner's."),
  evidence: z.array(EvidenceSchema).min(1).max(6),
  problem: z.string().trim().min(1).max(300).describe('What is wrong, in one sentence.'),
  fix: z.string().trim().min(1).max(300).describe('The smallest change that fixes it.'),
});
export type CuratorIssue = z.infer<typeof CuratorIssueSchema>;

/** A second round's verdict on an earlier issue (`PREVIOUS ISSUES`). */
export const PreviousStatusSchema = z.strictObject({
  id: z.string().trim().min(1).describe('The earlier issue\'s id, "issue-<n>".'),
  status: z.enum(['fixed', 'not_fixed']),
});
export type PreviousStatus = z.infer<typeof PreviousStatusSchema>;

export const CuratorReviewSchema = z.strictObject({
  issues: z.array(CuratorIssueSchema).max(40).describe('Empty when every beat is fine.'),
  previous: z
    .array(PreviousStatusSchema)
    .optional()
    .describe('Only when the input lists PREVIOUS ISSUES: one status for each.'),
});
export type CuratorReview = z.infer<typeof CuratorReviewSchema>;

/** An issue from an earlier round, as the next round's input lists it. */
export type PreviousIssue = { id: string; issue: CuratorIssue };

// --- The two passes ------------------------------------------------------------------------------

/**
 * The review runs in two calls with the same system prompt; the user message names the pass and
 * gives its output shape. PASS claims audits every narration sentence and every board label that
 * shows a number, each with the ids that support it or an issue; PASS story reports the rest.
 */
export const REVIEW_PASSES = ['claims', 'story'] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

export const PASS_CATEGORIES: Readonly<Record<ReviewPass, readonly ReviewCategory[]>> = {
  claims: ['unsupported_claim', 'number_wrong_meaning'],
  story: REVIEW_CATEGORIES.filter((c) => c !== 'unsupported_claim' && c !== 'number_wrong_meaning'),
};

export const ClaimSchema = z.strictObject({
  beatId: z.string().trim().min(1),
  source: z.enum(['narration', 'label']),
  elementId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('For a label: the board element (its id in BOARD).'),
  text: QuoteSchema.describe('The whole sentence, or the label text or value, copied exactly.'),
  verdict: z
    .enum(['supported', 'no_claim', 'issue'])
    .describe(
      'supported: the ids state it; no_claim: it states no fact or number (a question, a link); issue: reported under issues.',
    ),
  ids: z
    .array(ResearchIdSchema)
    .max(8)
    .describe('The "fact-<n>" and "num-<n>" ids that state it; empty unless supported.'),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ClaimsPassSchema = z.strictObject({
  claims: z
    .array(ClaimSchema)
    .max(200)
    .describe(
      'Every narration sentence of every beat, and every board label that shows a number, in order.',
    ),
  issues: z
    .array(CuratorIssueSchema)
    .max(40)
    .describe('Only unsupported_claim and number_wrong_meaning.'),
});
export type ClaimsPass = z.infer<typeof ClaimsPassSchema>;

/** PASS story's answer: the other categories, and a second round's statuses. */
export const StoryPassSchema = CuratorReviewSchema;

// --- Code's rules per category -------------------------------------------------------------------

type SeverityCap = Readonly<Record<ExplanationLevel, z.infer<typeof IssueSeveritySchema>>>;

const ALWAYS_BLOCKING: SeverityCap = {
  beginner: 'blocking',
  intermediate: 'blocking',
  expert: 'blocking',
};
const ALWAYS_ADVISORY: SeverityCap = {
  beginner: 'advisory',
  intermediate: 'advisory',
  expert: 'advisory',
};
/** Clarity blocks only at beginner, and only when the beat's point depends on it (the model judges). */
const BEGINNER_BLOCKING: SeverityCap = {
  beginner: 'blocking',
  intermediate: 'advisory',
  expert: 'advisory',
};

/** Evidence kinds that quote what the viewer hears or sees. */
export const SHOWN_KINDS: readonly EvidenceKind[] = [
  'narration',
  'headline',
  'tag',
  'stat_card',
  'source',
  'label',
];

export type CategoryRule = {
  /** Who may own an issue of this category. */
  owners: readonly CuratorOwner[];
  /** The most severe an issue of this category may be, per level. */
  cap: SeverityCap;
  /** At least one evidence item of these kinds. */
  needs: readonly EvidenceKind[];
};

export const CATEGORY_RULES: Readonly<Record<ReviewCategory, CategoryRule>> = {
  unsupported_claim: {
    owners: ['scriptwriter', 'generator'],
    cap: ALWAYS_BLOCKING,
    needs: SHOWN_KINDS,
  },
  wrong_simplification: {
    owners: ['scriptwriter', 'generator'],
    cap: ALWAYS_BLOCKING,
    needs: SHOWN_KINDS,
  },
  number_wrong_meaning: {
    owners: ['scriptwriter', 'generator'],
    cap: ALWAYS_BLOCKING,
    needs: ['number'],
  },
  visual_contradicts: { owners: ['generator'], cap: ALWAYS_BLOCKING, needs: ['label'] },
  visual_distracts: { owners: ['generator'], cap: ALWAYS_ADVISORY, needs: ['label'] },
  term_before_shown: {
    owners: ['scriptwriter', 'generator'],
    cap: BEGINNER_BLOCKING,
    needs: ['narration', 'label'],
  },
  above_level: {
    owners: ['scriptwriter'],
    cap: BEGINNER_BLOCKING,
    needs: ['narration', 'headline', 'tag'],
  },
  hook_retold: { owners: ['scriptwriter'], cap: ALWAYS_BLOCKING, needs: ['narration'] },
  small_stat_card: { owners: ['scriptwriter'], cap: ALWAYS_ADVISORY, needs: ['stat_card'] },
  missing_trade_off: { owners: ['director'], cap: ALWAYS_ADVISORY, needs: ['note', 'fact'] },
};

/** The issue with its severity capped for its category and the run's level. */
export function capSeverity(issue: CuratorIssue, level: ExplanationLevel): CuratorIssue {
  const cap = CATEGORY_RULES[issue.category].cap[level];
  return cap === 'advisory' && issue.severity === 'blocking'
    ? { ...issue, severity: 'advisory' }
    : issue;
}
