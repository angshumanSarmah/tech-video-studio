import { z } from 'zod';
import { ExplanationLevelSchema } from '../config/video.ts';
import { CuratorOwnerSchema, IssueSeveritySchema } from './issue.ts';
import { CuratorIssueSchema, PreviousStatusSchema } from './review.ts';

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

export const LlmUsageSchema = z.strictObject({
  calls: z.number().int().min(0),
  costUsd: z.number().min(0),
  inCached: z.number().int().min(0),
  inUncached: z.number().int().min(0),
  out: z.number().int().min(0),
  reasoning: z.number().int().min(0),
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export const CuratorReportSchema = z.strictObject({
  specVersionId: z.number().int().positive(),
  version: z.number().int().positive(),
  explanationLevel: ExplanationLevelSchema,
  codeIssues: z.array(CodeIssueSchema),
  /** Null when the spec failed validation (nothing to review until its errors are fixed). */
  review: z
    .strictObject({
      /** Verified issues, severities capped (`capSeverity`). */
      issues: z.array(CuratorIssueSchema),
      dropped: z.array(DroppedIssueSchema),
      /** Issues whose severity code lowered. */
      capped: z.number().int().min(0),
      previous: z.array(PreviousStatusSchema).optional(),
      usage: LlmUsageSchema,
    })
    .nullable(),
  /** Any blocking issue, code's or the review's: gate 3 does not auto-approve. */
  blocking: z.boolean(),
});
export type CuratorReport = z.infer<typeof CuratorReportSchema>;
