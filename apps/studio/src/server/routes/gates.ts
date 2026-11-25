import {
  GateDecisionRequestSchema,
  GateParamsSchema,
  type GateDecisionResponse,
  type GateDto,
} from '@explainer-studio/shared';
import { Hono } from 'hono';
import type { Db } from '#core/db/client.ts';
import { decideAtGate } from '#core/services/gate-decisions.ts';
import { readGate } from '#core/services/gates.ts';
import { toGateDto } from '../dto.ts';
import { validate } from '../validate.ts';

/** `/api/runs/:id/gates/:gate` (P1C.9): a gate's review payload, and decisions on it. */
export function createGatesRoute(db: Db, dataDir: string) {
  return new Hono()
    .get('/:id/gates/:gate', validate('param', GateParamsSchema), (c) => {
      const { id, gate } = c.req.valid('param');
      return c.json<GateDto>(toGateDto(readGate(db, dataDir, id, gate)));
    })
    .post(
      '/:id/gates/:gate',
      validate('param', GateParamsSchema),
      validate('json', GateDecisionRequestSchema),
      (c) => {
        const { id, gate } = c.req.valid('param');
        const result = decideAtGate(db, dataDir, id, gate, c.req.valid('json'));
        return c.json<GateDecisionResponse>(result);
      },
    );
}
