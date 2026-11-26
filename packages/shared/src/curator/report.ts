import { z } from 'zod';
import { ExplanationLevelSchema } from '../config/video.ts';
import { RecentStructureSchema } from '../memory/fingerprint.ts';
import { CuratorOwnerSchema, IssueSeveritySchema } from './issue.ts';
import { RepairOutputSchema, RepairRequestSchema } from './repair.ts';
import { LlmUsageSchema } from './usage.ts';
import { ClaimSchema, CuratorIssueSchema, PreviousStatusSchema } from './review.ts';

/**
 * The `curate` job's step files (P1C.8): what it read (`curate/input-<step>.json`) and what it
 * found (`curate/report-<step>.json`): the code checks' issues and the review's, with what code
 * did to the review (issues dropped because their evidence did not verify, severities capped).
 * Gate 3 reads the newest report (`latestCuration`).
 */

export const CodeIssueSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  severity: IssueSeveritySchema,
  owner: CuratorOwnerSchema,
});

export const CurateInputSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
  directStepId: z.number().int().positive(),
  researchStepId: z.number().int().positive(),
  model: z.string(),
  explanationLevel: ExplanationLevelSchema,
  /**
   * What the variety checks read from the usage history (P1C.10): the recent videos' combos,
   * patterns and structures. Absent in steps from before usage history.
   */
  /** The Curator's active style rules (P1C.10), as its review prompts carry them. */
  styleRules: z.array(z.string()).optional(),
  recent: z
    .strictObject({
      videos: z.number().int().min(0),
      combos: z.array(z.string()),
      patterns: z.array(z.string()),
      structures: z.array(RecentStructureSchema),
    })
    .optional(),
});
export type CurateInput = z.infer<typeof CurateInputSchema>;

const ReasonSchema = z.strictObject({ path: z.string(), code: z.string(), message: z.string() });

/** A review issue code left out of the report, and why. */
export const DroppedIssueSchema = z.strictObject({
  issue: CuratorIssueSchema,
  /** `unverified`: its evidence still failed `curatorIssueProblems` after the repairs. */
  why: z.enum(['unverified', 'repeats_code_finding']),
  reasons: z.array(ReasonSchema),
});
export type DroppedIssue = z.infer<typeof DroppedIssueSchema>;

/** One repair round: what was asked, what the repair did, and the blocking set around it. */
export const CurateRoundSchema = z.strictObject({
  round: z.number().int().min(1),
  requests: z.array(RepairRequestSchema),
  repair: RepairOutputSchema,
  /** Beats put back to the version before the round (they came out with more blocking issues). */
  restored: z.array(z.string()),
  /** `<beat>:<code or category>` of every blocking issue, before and after the round. */
  blockingBefore: z.array(z.string()),
  blockingAfter: z.array(z.string()),
});
export type CurateRound = z.infer<typeof CurateRoundSchema>;

/** Why the repair loop ended. */
export const CURATE_STOPS = [
  'clean',
  'nothing_repairable',
  'no_progress',
  'max_rounds',
  'repair_failed',
  'repair_off',
  'invalid_spec',
] as const;

/** One issue as gate 3 shows it: a badge on its beat (or the whole video). */
export const GateBadgeSchema = z.strictObject({
  beatId: z.string().nullable(),
  source: z.enum(['code', 'review']),
  /** The code check's code, or the review's category. */
  code: z.string(),
  severity: IssueSeveritySchema,
  owner: CuratorOwnerSchema,
  message: z.string(),
  /** Owned by the Director or the Researcher: no repair can fix it, the plan or notes must change. */
  needsPlanChange: z.boolean(),
});
export type GateBadge = z.infer<typeof GateBadgeSchema>;

export const CuratorReportSchema = z.strictObject({
  /** The version the job was given, and the version it ended on (after repairs). */
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
  final: z.strictObject({
    specVersionId: z.number().int().positive(),
    version: z.number().int().positive(),
  }),
  explanationLevel: ExplanationLevelSchema,
  /** The code checks on the final version. */
  codeIssues: z.array(CodeIssueSchema),
  /** The review as it stands on the final version (issues carried over and new). */
  review: z
    .strictObject({
      /** Verified issues, severities capped (`capSeverity`). */
      issues: z.array(CuratorIssueSchema),
      dropped: z.array(DroppedIssueSchema),
      /** Issues whose severity code lowered. */
      capped: z.number().int().min(0),
      previous: z.array(PreviousStatusSchema).optional(),
      /** PASS claims' audit: every narration sentence and numeric label, with its support. */
      claims: z.array(ClaimSchema),
      /** Repair turns for left-out sentences or labels, and what was still out at the end. */
      coverage: z.strictObject({
        repairs: z.number().int().min(0),
        missing: z.array(z.string()),
      }),
      /** Calls per pass (attempts included). */
      calls: z.strictObject({
        claims: z.number().int().min(0),
        story: z.number().int().min(0),
      }),
      usage: LlmUsageSchema,
    })
    .nullable(),
  rounds: z.array(CurateRoundSchema),
  stop: z.enum(CURATE_STOPS),
  /** Every issue left, for gate 3. */
  badges: z.array(GateBadgeSchema),
  /**
   * A scoped curate (a gate's "regenerate beat"): the version the review was scoped against and
   * the beats it reviewed; the others' issues carried over. `badgeOnlyBeatIds`: the beats the
   * person regenerated, never auto-repaired (absent in reports from before).
   */
  scope: z
    .strictObject({
      sinceSpecVersionId: z.number().int().positive(),
      changedBeatIds: z.array(z.string()),
      badgeOnlyBeatIds: z.array(z.string()).optional(),
    })
    .optional(),
  /** Any blocking issue left, code's or the review's: gate 3 does not auto-approve. */
  blocking: z.boolean(),
  cost: z.strictObject({
    reviewUsd: z.number().min(0),
    repairUsd: z.number().min(0),
    totalUsd: z.number().min(0),
  }),
});
export type CuratorReport = z.infer<typeof CuratorReportSchema>;
