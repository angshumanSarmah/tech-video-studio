import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_ROLES, ModelRoleSchema, type ModelRole } from '@explainer-studio/shared';
import { z } from 'zod';
import { RawUsageSchema, parseUsage } from './usage.ts';
import type { LlmTransport } from './types.ts';

/** One recorded response. `usage` is in the API's raw form, so cost maths runs as for real calls. */
export const DryRunResponseSchema = z.strictObject({
  content: z.string().nullable(),
  reasoningContent: z.string().nullable().default(null),
  servedModel: z.string().default('dry-run'),
  finishReason: z.string().default('stop'),
  usage: RawUsageSchema.nullable().default(null),
});
export type DryRunResponse = z.input<typeof DryRunResponseSchema>;

/** Responses per role, replayed in order. */
export type DryRunFixtures = Partial<Record<ModelRole, readonly DryRunResponse[]>>;

export class DryRunExhaustedError extends Error {
  override readonly name = 'DryRunExhaustedError';
}

/**
 * Replays recorded responses instead of calling the API: each call for a role takes that role's
 * next response, and running out throws. Calls are still logged and costed by the client.
 */
export function dryRunTransport(fixtures: DryRunFixtures): LlmTransport {
  const queues = new Map(
    MODEL_ROLES.map((role) => [
      role,
      (fixtures[role] ?? []).map((r) => DryRunResponseSchema.parse(r)),
    ]),
  );
  return {
    send(request) {
      if (request.signal?.aborted) return Promise.reject(request.signal.reason as Error);
      const next = queues.get(request.role)?.shift();
      if (!next) {
        return Promise.reject(
          new DryRunExhaustedError(`No recorded ${request.role} response left (dry run)`),
        );
      }
      return Promise.resolve({
        content: next.content,
        reasoningContent: next.reasoningContent,
        servedModel: next.servedModel,
        finishReason: next.finishReason,
        usage: parseUsage(next.usage),
        rawUsage: next.usage,
      });
    },
  };
}

/** Loads `<dir>/<role>.json` files, each an array of recorded responses. Other files are ignored. */
export function loadDryRunFixtures(dir: string): DryRunFixtures {
  const fixtures: DryRunFixtures = {};
  for (const file of readdirSync(dir)) {
    const role = ModelRoleSchema.safeParse(file.replace(/\.json$/, ''));
    if (!file.endsWith('.json') || !role.success) continue;
    const json: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    fixtures[role.data] = z.array(DryRunResponseSchema).parse(json);
  }
  return fixtures;
}
