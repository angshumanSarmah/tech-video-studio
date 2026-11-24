import type { Registries } from '@explainer-studio/renderer/catalog';
import {
  capSeverity,
  curatorIssueProblems,
  CuratorReviewSchema,
  type CodeIssue,
  type CuratorIssue,
  type CuratorReview,
  type DroppedIssue,
  type ExplanationLevel,
  type RenderableVideoSpec,
  type ResearchNotes,
  type ReviewCategory,
  type ReviewCheckContext,
  type LogLevel,
} from '@explainer-studio/shared';
import type { CheckAttempt, LlmClient } from '../../llm/client.ts';
import type { OutputIssue } from '../../llm/types.ts';
import { buildPrompt } from '../prompt-builder.ts';
import type { PromptVariables } from '../prompt-variables.ts';
import type { PromptTemplates } from '../prompts/templates.ts';
import { beatOfPath, curatorUserMessage, reviewBeatTexts, type CuratorRound } from './input.ts';

/**
 * The Curator's review call (P1C.8 part 2): one call per video. The answer is verified by
 * `curatorIssueProblems` as the call's `check`, so evidence that is not in the input is sent
 * back for repair; on the last attempt those problems are soft, the answer comes back, and
 * `settleReview` drops what still does not verify. It also drops an issue that repeats a code
 * finding on the same beat, and caps each severity by category and level (`capSeverity`).
 */

export interface ReviewDeps {
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  readonly variables: PromptVariables;
  readonly registries: Registries;
  readonly runId: number;
  readonly stepId: number;
  readonly signal?: AbortSignal;
  readonly log?: (level: LogLevel, message: string) => void;
}

export interface ReviewRequest {
  readonly spec: RenderableVideoSpec;
  readonly notes: ResearchNotes;
  readonly level: ExplanationLevel;
  readonly codeIssues: readonly CodeIssue[];
  readonly round?: CuratorRound;
}

export interface SettledReview {
  readonly issues: CuratorIssue[];
  readonly dropped: DroppedIssue[];
  readonly capped: number;
  readonly previous?: CuratorReview['previous'];
}

export interface ReviewResult extends SettledReview {
  readonly callIds: readonly number[];
}

export async function reviewSpec(deps: ReviewDeps, request: ReviewRequest): Promise<ReviewResult> {
  const checkContext: ReviewCheckContext = {
    beats: reviewBeatTexts(request.spec, { registries: deps.registries }),
    notes: request.notes,
    ...(request.round ? { previousIds: request.round.previous.map((p) => p.id) } : {}),
  };
  const prompt = buildPrompt(deps.prompts, {
    role: 'curator',
    variables: deps.variables,
    input: curatorUserMessage({
      spec: request.spec,
      notes: request.notes,
      level: request.level,
      codeIssues: request.codeIssues,
      registries: deps.registries,
      ...(request.round ? { round: request.round } : {}),
    }),
  });
  const result = await deps.llm.callJson({
    role: 'curator',
    prompt,
    schema: CuratorReviewSchema,
    runId: deps.runId,
    stepId: deps.stepId,
    check: reviewCheck(checkContext),
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  });
  const settled = settleReview(result.value, {
    check: checkContext,
    level: request.level,
    spec: request.spec,
    codeIssues: request.codeIssues,
  });
  return { ...settled, callIds: result.callIds };
}

/** Verification as the call's check: repaired while repairs are left, soft on the last attempt. */
export function reviewCheck(
  ctx: ReviewCheckContext,
): (value: unknown, attempt: CheckAttempt) => OutputIssue[] {
  return (value, attempt) =>
    curatorIssueProblems(value, ctx).map((p) => ({
      path: p.path,
      code: p.code,
      message: p.message,
      ...(attempt.final ? { soft: true } : {}),
    }));
}

/** Code findings a review category would only repeat, on the same beat. */
const REPEATS_CODE: Partial<Record<ReviewCategory, readonly string[]>> = {
  hook_retold: ['hook_number_repeated'],
};

export interface SettleContext {
  readonly check: ReviewCheckContext;
  readonly level: ExplanationLevel;
  readonly spec: RenderableVideoSpec;
  readonly codeIssues: readonly CodeIssue[];
}

/** The verified issues, severities capped; what was dropped and why. Pure. */
export function settleReview(review: CuratorReview, ctx: SettleContext): SettledReview {
  const problems = curatorIssueProblems(review, ctx.check);
  const issues: CuratorIssue[] = [];
  const dropped: DroppedIssue[] = [];
  let capped = 0;
  review.issues.forEach((issue, i) => {
    const prefix = `$.issues[${i}]`;
    const reasons = problems
      .filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`))
      .map(({ path, code, message }) => ({ path, code, message }));
    if (reasons.length > 0) {
      dropped.push({ issue, why: 'unverified', reasons });
      return;
    }
    const repeated = repeatedCodeFinding(issue, ctx);
    if (repeated) {
      dropped.push({ issue, why: 'repeats_code_finding', reasons: [repeated] });
      return;
    }
    const kept = capSeverity(issue, ctx.level);
    if (kept.severity !== issue.severity) capped += 1;
    issues.push(kept);
  });
  return {
    issues,
    dropped,
    capped,
    ...(review.previous ? { previous: review.previous } : {}),
  };
}

function repeatedCodeFinding(issue: CuratorIssue, ctx: SettleContext) {
  const codes = REPEATS_CODE[issue.category] ?? [];
  const finding = ctx.codeIssues.find(
    (c) => codes.includes(c.code) && beatOfPath(ctx.spec, c.path) === issue.beatId,
  );
  return finding ? { path: finding.path, code: finding.code, message: finding.message } : undefined;
}
