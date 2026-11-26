import type { Registries } from '@explainer-studio/renderer/catalog';
import {
  capSeverity,
  ClaimsPassSchema,
  reviewPassProblems,
  StoryPassSchema,
  type Claim,
  type ClaimsPass,
  type CodeIssue,
  type CuratorIssue,
  type CuratorReview,
  type DroppedIssue,
  type ExplanationLevel,
  type LogLevel,
  type RenderableVideoSpec,
  type ResearchNotes,
  type ReviewCategory,
  type ReviewCheckContext,
  type ReviewPass,
} from '@explainer-studio/shared';
import type { z } from 'zod';
import type { CheckAttempt, LlmClient } from '../../llm/client.ts';
import type { OutputIssue } from '../../llm/types.ts';
import { buildPrompt } from '../prompt-builder.ts';
import type { PromptVariables } from '../prompt-variables.ts';
import type { PromptTemplates } from '../prompts/templates.ts';
import {
  beatOfPath,
  curatorUserMessage,
  hasDrawnValues,
  reviewBeatTexts,
  roundCoverage,
  type CuratorRound,
} from './input.ts';

/**
 * The Curator's review (P1C.8 part 2): two calls per video with the same system prompt and the
 * same user message up to its last section, which names the pass and its output shape (so the
 * second call reuses the cached prefix). PASS claims audits every narration sentence and every
 * numeric board label; PASS story reports the other categories. Each answer is checked by
 * `reviewPassProblems` as the call's `check`: evidence not in the input, an issue of the other
 * pass, or (claims) a sentence left out is sent back for repair; on the last attempt those
 * problems are soft, the answer comes back, and `settleReview` drops the issues that still do not
 * verify. It also drops an issue that repeats a code finding on the same beat, and caps each
 * severity by category and level (`capSeverity`).
 */

export interface ReviewDeps {
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
  readonly variables: PromptVariables;
  readonly registries: Registries;
  readonly runId: number;
  readonly stepId: number;
  /** The Curator's style rules section (P1C.10), last in the system message both passes share. */
  readonly styleRules?: string | undefined;
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
  /** PASS claims' audit, as answered. */
  readonly claims: Claim[];
  /** Repair turns the claims pass needed for left-out sentences or labels, and what stayed out. */
  readonly coverage: { readonly repairs: number; readonly missing: string[] };
  readonly calls: Readonly<Record<ReviewPass, readonly number[]>>;
}

/** Problems that mean the claims pass left a sentence or a numeric label out. */
const COVERAGE_CODES: readonly string[] = ['claim_missing', 'label_claim_missing'];

export async function reviewSpec(deps: ReviewDeps, request: ReviewRequest): Promise<ReviewResult> {
  const beats = reviewBeatTexts(request.spec, { registries: deps.registries });
  const coverage = roundCoverage(request.round);
  const base: ReviewCheckContext = { beats, notes: request.notes };
  const claimsContext: ReviewCheckContext = { ...base, ...(coverage ? { coverage } : {}) };
  const storyContext: ReviewCheckContext = {
    ...base,
    ...(request.round ? { previousIds: request.round.previous.map((p) => p.id) } : {}),
  };
  let coverageRepairs = 0;
  // A board-only round whose boards draw no values has nothing for PASS claims: no call.
  const claims =
    coverage && !coverage.narration && !hasDrawnValues(request.spec, coverage.beatIds, deps)
      ? { value: { claims: [], issues: [] } as ClaimsPass, callIds: [] as number[] }
      : await runPass(deps, request, 'claims', ClaimsPassSchema, claimsContext, () => {
          coverageRepairs += 1;
        });
  const story = await runPass(deps, request, 'story', StoryPassSchema, storyContext);
  const settle = (
    pass: ReviewPass,
    review: { issues: CuratorIssue[] },
    check: ReviewCheckContext,
  ) =>
    settleReview(pass, review, {
      check,
      level: request.level,
      spec: request.spec,
      codeIssues: request.codeIssues,
    });
  const fromClaims = settle('claims', claims.value, claimsContext);
  const fromStory = settle('story', story.value, storyContext);
  const missing = reviewPassProblems('claims', claims.value, claimsContext)
    .filter((p) => COVERAGE_CODES.includes(p.code))
    .map((p) => p.message);
  return {
    issues: [...fromClaims.issues, ...fromStory.issues],
    dropped: [...fromClaims.dropped, ...fromStory.dropped],
    capped: fromClaims.capped + fromStory.capped,
    ...(story.value.previous ? { previous: story.value.previous } : {}),
    claims: mergeClaims(request.spec, request.round, claims.value.claims),
    coverage: { repairs: coverageRepairs, missing },
    calls: { claims: claims.callIds, story: story.callIds },
  };
}

/**
 * The audit standing after a round (pure): the earlier entries of beats this round did not list
 * (unchanged beats; a board-only round's narration), then this round's entries on the beats it
 * covers, in beat order. Outside a carried round, the answer as it is.
 */
export function mergeClaims(
  spec: RenderableVideoSpec,
  round: CuratorRound | undefined,
  answered: readonly Claim[],
): Claim[] {
  const coverage = roundCoverage(round);
  if (!coverage || !round?.previousClaims) return [...answered];
  const covered = new Set(coverage.beatIds);
  const listsNow = (c: Claim) =>
    covered.has(c.beatId) && (coverage.narration || c.source === 'value');
  const order = new Map(spec.story.beats.map((b, i) => [b.id, i]));
  const at = (c: Claim) => order.get(c.beatId) ?? order.size;
  return [...round.previousClaims.filter((c) => !listsNow(c)), ...answered.filter(listsNow)]
    .map((claim, i) => ({ claim, i }))
    .sort((a, b) => at(a.claim) - at(b.claim) || a.i - b.i)
    .map(({ claim }) => claim);
}

async function runPass<S extends z.ZodType>(
  deps: ReviewDeps,
  request: ReviewRequest,
  pass: ReviewPass,
  schema: S,
  check: ReviewCheckContext,
  onCoverageRepair?: () => void,
) {
  const prompt = buildPrompt(deps.prompts, {
    role: 'curator',
    variables: deps.variables,
    ...(deps.styleRules ? { styleRules: deps.styleRules } : {}),
    input: curatorUserMessage({
      spec: request.spec,
      notes: request.notes,
      level: request.level,
      codeIssues: request.codeIssues,
      registries: deps.registries,
      pass,
      ...(request.round ? { round: request.round } : {}),
    }),
  });
  return deps.llm.callJson({
    role: 'curator',
    prompt,
    schema,
    runId: deps.runId,
    stepId: deps.stepId,
    check: passCheck(pass, check, onCoverageRepair),
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  });
}

/**
 * A pass's verification as the call's check: repaired while repairs are left, soft on the last
 * attempt. `onCoverageRepair` hears each repair turn a left-out sentence or label causes.
 */
export function passCheck(
  pass: ReviewPass,
  ctx: ReviewCheckContext,
  onCoverageRepair?: () => void,
): (value: unknown, attempt: CheckAttempt) => OutputIssue[] {
  return (value, attempt) => {
    const problems = reviewPassProblems(pass, value, ctx);
    if (!attempt.final && problems.some((p) => COVERAGE_CODES.includes(p.code))) {
      onCoverageRepair?.();
    }
    return problems.map((p) => ({
      path: p.path,
      code: p.code,
      message: p.message,
      ...(attempt.final ? { soft: true } : {}),
    }));
  };
}

/** Code findings a review category would only repeat, on the same beat. */
const REPEATS_CODE: Partial<Record<ReviewCategory, readonly string[]>> = {
  hook_retold: ['hook_number_repeated'],
  term_before_shown: ['term_shown_late'],
};

export interface SettleContext {
  readonly check: ReviewCheckContext;
  readonly level: ExplanationLevel;
  readonly spec: RenderableVideoSpec;
  readonly codeIssues: readonly CodeIssue[];
}

/** A pass's verified issues, severities capped; what was dropped and why. Pure. */
export function settleReview(
  pass: ReviewPass,
  review: { issues: readonly CuratorIssue[] },
  ctx: SettleContext,
): SettledReview {
  const problems = reviewPassProblems(pass, { issues: review.issues }, ctx.check);
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
  return { issues, dropped, capped };
}

function repeatedCodeFinding(issue: CuratorIssue, ctx: SettleContext) {
  const codes = REPEATS_CODE[issue.category] ?? [];
  const finding = ctx.codeIssues.find(
    (c) => codes.includes(c.code) && beatOfPath(ctx.spec, c.path) === issue.beatId,
  );
  return finding ? { path: finding.path, code: finding.code, message: finding.message } : undefined;
}
