import {
  agentsReached,
  MAX_RULES_PER_AGENT,
  scopesReaching,
  type MemoryRuleAction,
  type MemoryRuleScope,
  type MemoryRuleStatus,
  type RuleAgent,
} from '@explainer-studio/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.ts';
import { memoryRules } from '../db/schema.ts';
import { ConflictError, NotFoundError } from '../errors.ts';

/**
 * Style rules (P1C.10): proposed by the Analyst from a gate note (or added by hand), applied to
 * an agent's prompts only while active. At most `MAX_RULES_PER_AGENT` active rules reach any one
 * agent (its own scope, plus `all` for a writer); a change past that is a `ConflictError`.
 */

export type MemoryRule = typeof memoryRules.$inferSelect;

/**
 * The active rules that reach one agent, oldest first (so a new rule appends and the earlier
 * ones stay a shared prompt prefix), as prompt section 5 lists them.
 */
export function activeStyleRules(db: Executor, agent: RuleAgent): string[] {
  return db
    .select({ text: memoryRules.text })
    .from(memoryRules)
    .where(and(eq(memoryRules.status, 'active'), inArray(memoryRules.scope, scopesReaching(agent))))
    .orderBy(asc(memoryRules.id))
    .all()
    .map((r) => r.text);
}

export interface RuleFilter {
  readonly status?: MemoryRuleStatus | undefined;
  readonly scope?: MemoryRuleScope | undefined;
}

/** Rules, oldest first, optionally of one status and scope. */
export function listRules(db: Executor, filter: RuleFilter = {}): MemoryRule[] {
  const where = and(
    filter.status ? eq(memoryRules.status, filter.status) : undefined,
    filter.scope ? eq(memoryRules.scope, filter.scope) : undefined,
  );
  return db.select().from(memoryRules).where(where).orderBy(asc(memoryRules.id)).all();
}

export function getRule(db: Executor, id: number): MemoryRule | undefined {
  return db.select().from(memoryRules).where(eq(memoryRules.id, id)).get();
}

function requireRule(db: Executor, id: number): MemoryRule {
  const rule = getRule(db, id);
  if (!rule) throw new NotFoundError('Style rule', id);
  return rule;
}

/** A rule written by hand: active at once, within the cap. */
export function addRule(db: Db, input: { scope: MemoryRuleScope; text: string }): MemoryRule {
  return db.transaction((tx) => {
    assertRoom(tx, input.scope, undefined);
    return tx
      .insert(memoryRules)
      .values({ scope: input.scope, text: input.text, status: 'active' })
      .returning()
      .get();
  });
}

/** A proposal from the Analyst: stored as `proposed`, applied only once accepted. */
export interface NewProposal {
  readonly scope: MemoryRuleScope;
  readonly text: string;
  readonly note: string;
  readonly reason: string;
  readonly sourceRunId: number | null;
  readonly sourceGate: MemoryRule['sourceGate'];
  readonly sourceEventId: number;
}

export function recordProposal(db: Executor, proposal: NewProposal): MemoryRule {
  return db
    .insert(memoryRules)
    .values({ ...proposal, status: 'proposed' })
    .returning()
    .get();
}

/** The proposal made from a gate decision event, if any (newest). */
export function proposalOfEvent(db: Executor, eventId: number): MemoryRule | undefined {
  return db
    .select()
    .from(memoryRules)
    .where(eq(memoryRules.sourceEventId, eventId))
    .orderBy(asc(memoryRules.id))
    .all()
    .at(-1);
}

export interface RulePatch {
  readonly action?: MemoryRuleAction | undefined;
  readonly text?: string | undefined;
  readonly scope?: MemoryRuleScope | undefined;
}

/** Which status an action moves a rule from, and to. */
const TRANSITIONS: Readonly<
  Record<MemoryRuleAction, { readonly from: MemoryRuleStatus; readonly to: MemoryRuleStatus }>
> = {
  accept: { from: 'proposed', to: 'active' },
  reject: { from: 'proposed', to: 'rejected' },
  activate: { from: 'inactive', to: 'active' },
  deactivate: { from: 'active', to: 'inactive' },
};

/**
 * An action (accept, reject, activate, deactivate) and/or a new text or scope (an accepted
 * proposal may be edited on the way). A rejected rule is not edited; an action from the wrong
 * status, or a rule that would be active past the cap, is a `ConflictError`.
 */
export function updateRule(db: Db, id: number, patch: RulePatch): MemoryRule {
  return db.transaction((tx) => {
    const rule = requireRule(tx, id);
    const status = nextStatus(rule, patch.action);
    if (rule.status === 'rejected' && (patch.text !== undefined || patch.scope !== undefined)) {
      throw new ConflictError(`Style rule ${id} was rejected: add a new rule instead.`);
    }
    const scope = patch.scope ?? rule.scope;
    if (status === 'active') assertRoom(tx, scope, id);
    return tx
      .update(memoryRules)
      .set({ status, scope, text: patch.text ?? rule.text, updatedAt: new Date() })
      .where(eq(memoryRules.id, id))
      .returning()
      .get();
  });
}

function nextStatus(rule: MemoryRule, action: MemoryRuleAction | undefined): MemoryRuleStatus {
  if (!action) return rule.status;
  const { from, to } = TRANSITIONS[action];
  if (rule.status !== from) {
    throw new ConflictError(
      `Style rule ${rule.id} is ${rule.status}: only a ${from} rule can be ${DONE[action]}.`,
    );
  }
  return to;
}

const DONE: Readonly<Record<MemoryRuleAction, string>> = {
  accept: 'accepted',
  reject: 'rejected',
  activate: 'activated',
  deactivate: 'deactivated',
};

export function deleteRule(db: Executor, id: number): void {
  requireRule(db, id);
  db.delete(memoryRules).where(eq(memoryRules.id, id)).run();
}

/** Every agent a rule of `scope` reaches has room for one more active rule (`except` aside). */
function assertRoom(db: Executor, scope: MemoryRuleScope, except: number | undefined): void {
  for (const agent of agentsReached(scope)) {
    const active = db
      .select({ id: memoryRules.id })
      .from(memoryRules)
      .where(
        and(
          eq(memoryRules.status, 'active'),
          inArray(memoryRules.scope, scopesReaching(agent)),
          except === undefined ? undefined : ne(memoryRules.id, except),
        ),
      )
      .all().length;
    if (active >= MAX_RULES_PER_AGENT) {
      throw new ConflictError(
        `The ${agent} already has ${MAX_RULES_PER_AGENT} active rules (its own and "all"): ` +
          'deactivate one first.',
      );
    }
  }
}
