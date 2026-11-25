import {
  analystProblems,
  AnalystOutputSchema,
  ruleScopesSection,
  settleProposal,
  type ProposalOutcome,
} from '@explainer-studio/shared';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import {
  notedDecision,
  PROPOSE_RULE_JOB_TYPE,
  type NotedDecision,
} from '#core/services/rule-proposals.ts';
import { proposalOfEvent, recordProposal } from '#core/services/style-rules.ts';
import { analystContext } from '../agents/analyst/context.ts';
import { analystUserMessage } from '../agents/analyst/input.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import type { LlmClient } from '../llm/client.ts';
import { defineJobHandler, type JobContext } from './handler.ts';

export interface ProposeRuleJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
}

const PayloadSchema = z.strictObject({ eventId: z.number().int().positive() });
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * The Analyst (P1C.10): one gate decision's note becomes at most one proposed style rule, or a
 * logged reason why not. The job belongs to no run (`run_id` null): its call is outside any run
 * (the client's own model, no video's cost or cap), and its failure fails nothing else. A rule
 * already proposed from the event is not proposed again (at-least-once delivery).
 */
export function proposeRuleJobHandler(deps: ProposeRuleJobDeps) {
  return defineJobHandler({
    type: PROPOSE_RULE_JOB_TYPE,
    description: 'Proposes one style rule from a gate decision’s note (the Analyst).',
    payloadSchema: PayloadSchema,
    failsRun: false,
    run: (ctx) => propose(deps, ctx),
  });
}

async function propose(deps: ProposeRuleJobDeps, ctx: Ctx): Promise<void> {
  const { eventId } = ctx.payload;
  const already = proposalOfEvent(deps.db, eventId);
  if (already) {
    ctx.log('info', `Rule ${already.id} was already proposed from event ${eventId}.`);
    return;
  }
  const noted = notedDecision(deps.db, eventId);
  const outcome = await analyse(deps, ctx, noted);
  if (outcome.kind === 'none') {
    ctx.log('info', noRuleLine(outcome));
    return;
  }
  const rule = recordProposal(deps.db, {
    scope: outcome.scope,
    text: outcome.text,
    note: noted.decision.note,
    reason: outcome.why,
    sourceRunId: noted.runId,
    sourceGate: noted.gate,
    sourceEventId: eventId,
  });
  ctx.log('info', `Proposed rule ${rule.id} (${rule.scope}): ${rule.text}`);
}

async function analyse(
  deps: ProposeRuleJobDeps,
  ctx: Ctx,
  noted: NotedDecision,
): Promise<ProposalOutcome> {
  const { run, input, check } = analystContext(deps.db, deps.dataDir, noted);
  const prompt = buildPrompt(deps.prompts, {
    role: 'analyst',
    variables: run.resolvedSettings.video,
    catalogue: ruleScopesSection(),
    input: analystUserMessage(input),
  });
  const result = await deps.llm.callJson({
    role: 'analyst',
    prompt,
    schema: AnalystOutputSchema,
    check: (value) => analystProblems(value, check),
    signal: ctx.signal,
    log: ctx.log,
  });
  return settleProposal(result.value, input.existingRules);
}

/** The log line for a note that gives no rule (the CLI and the UI show it). */
export function noRuleLine(outcome: Extract<ProposalOutcome, { kind: 'none' }>): string {
  const of = outcome.duplicateOf !== undefined ? ` (rule ${outcome.duplicateOf})` : '';
  return `No rule (${outcome.reason}${of}): ${outcome.detail}`;
}
