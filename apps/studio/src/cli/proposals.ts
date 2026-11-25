import { RuleTextSchema } from '@explainer-studio/shared';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { getJob, type Job } from '#core/db/repositories/jobs.ts';
import { ConflictError } from '#core/errors.ts';
import { proposalOfEvent, updateRule, type MemoryRule } from '#core/services/style-rules.ts';
import type { CliContext } from './context.ts';

/**
 * Style-rule proposals from the terminal (P1C.10): wait for a `propose_rule` job, print what the
 * Analyst proposed (or why it proposed nothing), and in a terminal ask what to do with it.
 */

export interface PendingProposal {
  readonly jobId: number;
  readonly eventId: number;
}

const DEFAULT_POLL_MS = 250;
const TERMINAL: readonly string[] = ['done', 'failed', 'cancelled'];

/** Waits for each proposal's job, then reports and (in a terminal) reviews it. */
export async function settleProposals(
  ctx: CliContext,
  pending: readonly PendingProposal[],
): Promise<void> {
  for (const proposal of pending) {
    const job = await waitForJob(ctx, proposal.jobId);
    if (!job) return; // interrupted
    const rule = proposalOfEvent(ctx.db, proposal.eventId);
    if (!rule) {
      ctx.io.out(`Style rule: ${outcomeWithoutRule(ctx, job)}`);
      continue;
    }
    for (const line of proposedLines(rule)) ctx.io.out(line);
    if (ctx.io.isTTY) await reviewProposal(ctx, rule);
    else for (const line of ruleCommands(rule)) ctx.io.out(line);
  }
}

/** The job once it has ended; undefined when the wait is interrupted. */
export async function waitForJob(ctx: CliContext, jobId: number): Promise<Job | undefined> {
  for (;;) {
    const job = getJob(ctx.db, jobId);
    if (!job) return undefined;
    if (TERMINAL.includes(job.status)) return job;
    if (ctx.signal?.aborted) return undefined;
    await new Promise((resolve) => setTimeout(resolve, ctx.pollMs ?? DEFAULT_POLL_MS));
  }
}

/** Why a finished proposal job left no rule: its outcome line, or its error. */
function outcomeWithoutRule(ctx: CliContext, job: Job): string {
  if (job.status !== 'done') return `the proposal failed (${job.status}): ${job.error ?? '?'}`;
  const lines = listEventsSince(ctx.db, { jobId: job.id, afterId: 0, limit: 500 }).flatMap((e) =>
    e.type === 'log' && e.payload.level === 'info' ? [e.payload.message] : [],
  );
  return lines.find((l) => l.startsWith('No rule')) ?? lines.at(-1) ?? 'no rule proposed.';
}

/** Pure: the proposal as printed. */
export function proposedLines(rule: MemoryRule): string[] {
  return [
    `Style rule ${rule.id} proposed (${rule.scope}): ${rule.text}`,
    ...(rule.reason ? [`  why: ${rule.reason}`] : []),
  ];
}

/** Pure: the commands that decide a proposal later. */
export function ruleCommands(rule: MemoryRule): string[] {
  return [
    `  accept: pnpm studio rules accept ${rule.id} [--text "<edited>"] [--scope <scope>]`,
    `  reject: pnpm studio rules reject ${rule.id}`,
  ];
}

export const PROPOSAL_PROMPT = '[a]ccept / [e]dit "<text>" / [x] reject / [l]ater > ';

export type ProposalReply =
  | { readonly kind: 'accept' }
  | { readonly kind: 'edit'; readonly text: string }
  | { readonly kind: 'reject' }
  | { readonly kind: 'later' }
  | { readonly kind: 'invalid'; readonly message: string };

/** Pure: what the user typed at the proposal prompt. */
export function parseProposalReply(line: string): ProposalReply {
  const text = line.trim();
  const word = (text.split(/\s+/, 1)[0] ?? '').toLowerCase();
  const tail = text.slice(word.length).trim();
  switch (word) {
    case 'a':
    case 'accept':
      return { kind: 'accept' };
    case 'e':
    case 'edit': {
      const edited = /^(["'])([\s\S]*)\1$/.exec(tail)?.[2]?.trim() ?? tail;
      return edited
        ? { kind: 'edit', text: edited }
        : { kind: 'invalid', message: 'Edit with: e "<the rule as you want it>".' };
    }
    case 'x':
    case 'reject':
      return { kind: 'reject' };
    case 'l':
    case 'later':
    case '':
      return { kind: 'later' };
    default:
      return { kind: 'invalid', message: `Type a, e "<text>", x or l (not "${text}").` };
  }
}

async function reviewProposal(ctx: CliContext, rule: MemoryRule): Promise<void> {
  for (;;) {
    const answer = await ctx.io.ask(PROPOSAL_PROMPT);
    const reply = parseProposalReply(answer ?? 'later');
    try {
      switch (reply.kind) {
        case 'invalid':
          ctx.io.err(reply.message);
          continue;
        case 'later':
          for (const line of ruleCommands(rule)) ctx.io.out(line);
          return;
        case 'reject':
          updateRule(ctx.db, rule.id, { action: 'reject' });
          ctx.io.out(`Style rule ${rule.id} rejected.`);
          return;
        case 'accept':
        case 'edit': {
          const edited = reply.kind === 'edit' ? RuleTextSchema.safeParse(reply.text) : undefined;
          if (edited && !edited.success) {
            ctx.io.err(
              `A rule is one line of at most 160 characters: ${edited.error.issues[0]?.message}`,
            );
            continue;
          }
          const text = edited?.success ? { text: edited.data } : {};
          const active = updateRule(ctx.db, rule.id, { action: 'accept', ...text });
          ctx.io.out(`Style rule ${active.id} is active (${active.scope}): ${active.text}`);
          return;
        }
      }
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      ctx.io.err(error.message);
      return;
    }
  }
}
