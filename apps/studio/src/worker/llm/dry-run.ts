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

/**
 * One role's recorded answers: in call order, or one queue per replay key (the Generator's beat
 * ids, `{ [beatId]: DryRunResponse[] }`), so calls made in parallel replay deterministically.
 */
export type DryRunRecording =
  readonly DryRunResponse[] | Readonly<Record<string, readonly DryRunResponse[]>>;

export const DryRunRecordingSchema = z.union([
  z.array(DryRunResponseSchema),
  z.record(z.string(), z.array(DryRunResponseSchema)),
]);

/** Recorded answers per role. */
export type DryRunFixtures = Partial<Record<ModelRole, DryRunRecording>>;

export class DryRunExhaustedError extends Error {
  override readonly name = 'DryRunExhaustedError';
}

type Parsed = z.output<typeof DryRunResponseSchema>;

/**
 * Replays recorded responses instead of calling the API: each call for a role takes that role's
 * next response (from its replay key's queue when the role is recorded per key), and running
 * out throws. Calls are still logged and costed by the client.
 */
export function dryRunTransport(fixtures: DryRunFixtures): LlmTransport {
  const queues = new Map<string, Parsed[]>();
  const keyed = new Set<ModelRole>();
  for (const role of MODEL_ROLES) {
    const recording = fixtures[role] ?? [];
    if (isOrdered(recording)) {
      queues.set(
        role,
        recording.map((r) => DryRunResponseSchema.parse(r)),
      );
      continue;
    }
    keyed.add(role);
    for (const [key, list] of Object.entries(recording)) {
      queues.set(
        queueName(role, key),
        list.map((r) => DryRunResponseSchema.parse(r)),
      );
    }
  }
  return {
    send(request) {
      if (request.signal?.aborted) return Promise.reject(request.signal.reason as Error);
      const { role, replayKey } = request;
      if (keyed.has(role) && replayKey === undefined) {
        return Promise.reject(
          new DryRunExhaustedError(`${role} is recorded per key, but the call has no replayKey`),
        );
      }
      const queue = keyed.has(role) ? queueName(role, replayKey ?? '') : role;
      const next = queues.get(queue)?.shift();
      if (!next) {
        const where = keyed.has(role) ? ` for "${replayKey}"` : '';
        return Promise.reject(
          new DryRunExhaustedError(`No recorded ${role} response left${where} (dry run)`),
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

function isOrdered(recording: DryRunRecording): recording is readonly DryRunResponse[] {
  return Array.isArray(recording);
}

const queueName = (role: ModelRole, key: string) => `${role}\u0000${key}`;

/**
 * Loads `<dir>/<role>.json` files, each recorded answers in call order or per replay key. Other
 * files are ignored.
 */
export function loadDryRunFixtures(dir: string): DryRunFixtures {
  const fixtures: DryRunFixtures = {};
  for (const file of readdirSync(dir)) {
    const role = ModelRoleSchema.safeParse(file.replace(/\.json$/, ''));
    if (!file.endsWith('.json') || !role.success) continue;
    const json: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    fixtures[role.data] = DryRunRecordingSchema.parse(json);
  }
  return fixtures;
}

/** One role's recording in `dir`, which must be in call order (every role but the Generator's). */
export function recordedInOrder(dir: string, role: ModelRole): readonly DryRunResponse[] {
  const recording = loadDryRunFixtures(dir)[role];
  if (!recording) throw new Error(`No ${role}.json in ${dir}`);
  if (!isOrdered(recording)) throw new Error(`${role}.json in ${dir} is recorded per key`);
  return recording;
}
