import {
  CreateMemoryRuleRequestSchema,
  IdParamSchema,
  MemoryRuleQuerySchema,
  ProposeRuleRequestSchema,
  UpdateMemoryRuleRequestSchema,
  UsageQuerySchema,
  type MemoryRuleDto,
  type MemoryRuleListResponse,
  type ProposeRuleResponse,
  type UsageSummary,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { requestRuleProposal } from '#core/services/rule-proposals.ts';
import { addRule, deleteRule, listRules, updateRule } from '#core/services/style-rules.ts';
import { usageSummary } from '#core/services/usage-history.ts';
import { toMemoryRuleDto } from '../dto.ts';
import { validate } from '../validate.ts';

const RuleParamsSchema = z.object({ id: IdParamSchema });

/**
 * Memory (P1C.10): the usage history over the last exported videos, and style rules: list, add
 * by hand, accept / reject / edit / switch on and off, delete, and ask the Analyst for a proposal
 * from a gate decision's note (a `propose_rule` job; the server never calls a model).
 */
export function createMemoryRoute(db: Db) {
  return new Hono()
    .get('/usage', validate('query', UsageQuerySchema), (c) => {
      const { videos } = c.req.valid('query');
      return c.json<UsageSummary>(usageSummary(db, videos));
    })
    .get('/rules', validate('query', MemoryRuleQuerySchema), (c) => {
      const items = listRules(db, c.req.valid('query')).map(toMemoryRuleDto);
      return c.json<MemoryRuleListResponse>({ items });
    })
    .post('/rules', validate('json', CreateMemoryRuleRequestSchema), (c) => {
      return c.json<MemoryRuleDto>(toMemoryRuleDto(addRule(db, c.req.valid('json'))), 201);
    })
    .post('/rules/propose', validate('json', ProposeRuleRequestSchema), (c) => {
      const { eventId } = c.req.valid('json');
      const job = db.transaction((tx) => requestRuleProposal(tx, eventId));
      return c.json<ProposeRuleResponse>({ jobId: job.id }, 202);
    })
    .patch(
      '/rules/:id',
      validate('param', RuleParamsSchema),
      validate('json', UpdateMemoryRuleRequestSchema),
      (c) => {
        const { id } = c.req.valid('param');
        return c.json<MemoryRuleDto>(toMemoryRuleDto(updateRule(db, id, c.req.valid('json'))));
      },
    )
    .delete('/rules/:id', validate('param', RuleParamsSchema), (c) => {
      deleteRule(db, c.req.valid('param').id);
      return c.body(null, 204);
    });
}
