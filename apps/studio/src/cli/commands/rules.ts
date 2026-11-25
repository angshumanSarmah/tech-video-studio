import type { GateId } from '@explainer-studio/shared';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { requestRuleProposal } from '#core/services/rule-proposals.ts';
import {
  addRule,
  deleteRule,
  listRules,
  updateRule,
  type MemoryRule,
} from '#core/services/style-rules.ts';
import type { RulesCommand } from '../args.ts';
import { CliError, EXIT, type CliContext } from '../context.ts';
import { withWorker } from '../host.ts';
import { settleProposals } from '../proposals.ts';

/** `studio rules …` (P1C.10): style rules through the same services as the API. */
export async function rulesCommand(ctx: CliContext, cmd: RulesCommand): Promise<number> {
  switch (cmd.action) {
    case 'list':
      for (const line of ruleTable(listRules(ctx.db, cmd))) ctx.io.out(line);
      return EXIT.ok;
    case 'add':
      ctx.io.out(`Added: ${ruleLine(addRule(ctx.db, cmd))}`);
      return EXIT.ok;
    case 'update': {
      const { id, change, text, scope } = cmd;
      ctx.io.out(ruleLine(updateRule(ctx.db, id, { action: change, text, scope })));
      return EXIT.ok;
    }
    case 'delete':
      deleteRule(ctx.db, cmd.id);
      ctx.io.out(`Style rule ${cmd.id} deleted.`);
      return EXIT.ok;
    case 'propose':
      return propose(ctx, cmd);
  }
}

async function propose(
  ctx: CliContext,
  cmd: Extract<RulesCommand, { action: 'propose' }>,
): Promise<number> {
  const eventId =
    'eventId' in cmd.from ? cmd.from.eventId : latestNote(ctx, cmd.from.runId, cmd.from.gate);
  return withWorker(ctx, cmd.dryRun, async () => {
    const job = ctx.db.transaction((tx) => requestRuleProposal(tx, eventId));
    ctx.io.out(`The Analyst reads the note of event ${eventId} (job ${job.id}).`);
    await settleProposals(ctx, [{ jobId: job.id, eventId }]);
    return EXIT.ok;
  });
}

/** The newest decision with a note at a run's gate. */
function latestNote(ctx: CliContext, runId: number, gate: GateId): number {
  const events = listEventsSince(ctx.db, { runId, afterId: 0, limit: 100_000 });
  const noted = events.filter(
    (e) => e.type === 'gate' && e.payload.gate === gate && e.payload.decision?.note,
  );
  const last = noted.at(-1);
  if (!last) throw new CliError(`Run ${runId} has no decision with a note at the ${gate} gate.`);
  return last.id;
}

/** Pure: one rule on one line. */
export function ruleLine(rule: MemoryRule): string {
  return `rule ${rule.id} [${rule.scope}, ${rule.status}]: ${rule.text}`;
}

/** Pure: the rules, oldest first; a proposal with where it came from and why. */
export function ruleTable(rules: readonly MemoryRule[]): string[] {
  if (rules.length === 0) return ['No style rules.'];
  return rules.flatMap((rule) => [
    `  ${ruleLine(rule)}`,
    ...(rule.status === 'proposed' && rule.note
      ? [
          `      from: "${rule.note}" (run ${rule.sourceRunId ?? '?'}, ${rule.sourceGate ?? '?'} gate)`,
        ]
      : []),
    ...(rule.status === 'proposed' && rule.reason ? [`      why: ${rule.reason}`] : []),
  ]);
}
