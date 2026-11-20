import type { MemoryRuleScope } from '@explainer-studio/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { memoryRules } from '../db/schema.ts';

/**
 * Active style rules (P1C.10) for one agent: those scoped to it or to every agent, oldest first,
 * as prompt section 5 lists them.
 */
export function activeStyleRules(db: Executor, scope: Exclude<MemoryRuleScope, 'all'>): string[] {
  return db
    .select({ text: memoryRules.text })
    .from(memoryRules)
    .where(and(eq(memoryRules.status, 'active'), inArray(memoryRules.scope, [scope, 'all'])))
    .orderBy(asc(memoryRules.id))
    .all()
    .map((r) => r.text);
}
