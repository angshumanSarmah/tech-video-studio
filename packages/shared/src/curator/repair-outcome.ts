import { z } from 'zod';
import type { BeatScript } from '../spec/script.ts';
import {
  RepairRequestOutcomeSchema,
  type RepairRequest,
  type RepairRequestOutcome,
} from './repair.ts';

/**
 * What a gate's "regenerate beat N" did (pure): per repair request, whether its agent changed
 * something, and why not when it did not. A regenerate that changes nothing never looks like
 * success: the gate shows each `unchanged` request with its reason.
 */

/** A gate regenerate's outcome: the decision (its `gate` event) and each request's result. */
export const RegenerateOutcomeSchema = z.strictObject({
  decisionEventId: z.number().int().positive(),
  requests: z.array(RepairRequestOutcomeSchema).min(1),
});
export type RegenerateOutcome = z.infer<typeof RegenerateOutcomeSchema>;

/** The parts of a spec a request can change: each beat's script and board. */
export interface RepairableSpec {
  readonly script: readonly BeatScript[];
  readonly scenes: readonly { readonly beatId: string }[];
}

const AGENT_NAMES = { scriptwriter: 'Scriptwriter', generator: 'Generator' } as const;

/** Each request against the spec before and after the repair. */
export function requestOutcomes(
  requests: readonly RepairRequest[],
  before: RepairableSpec,
  after: RepairableSpec,
): RepairRequestOutcome[] {
  return requests.map((req) => {
    const base = { beatId: req.beatId, owner: req.owner, fields: [...req.fields] };
    const pick = req.owner === 'scriptwriter' ? scriptOf : sceneOf;
    if (!sameJson(pick(before, req.beatId), pick(after, req.beatId))) {
      return { ...base, outcome: 'changed' };
    }
    const what = req.owner === 'scriptwriter' ? req.fields.join(', ') : 'board';
    const reason = `the ${AGENT_NAMES[req.owner]} returned the same ${what}`;
    return { ...base, outcome: 'unchanged', reason };
  });
}

/**
 * Every request of a repair that failed (an agent's answer stayed invalid, so nothing was saved):
 * unchanged, with the failure's first issue as the reason.
 */
export function failedRequestOutcomes(
  requests: readonly RepairRequest[],
  error: string,
): RepairRequestOutcome[] {
  const reason = failureReason(error);
  return requests.map((req) => ({
    beatId: req.beatId,
    owner: req.owner,
    fields: [...req.fields],
    outcome: 'unchanged',
    reason,
  }));
}

/**
 * "generator output is still invalid after 2 repair attempts:\n- $: The board only fits…" →
 * "the Generator could not make a valid change: The board only fits…". Anything else: its first
 * line.
 */
export function failureReason(error: string): string {
  const lines = error.split('\n').map((l) => l.trim());
  const head = /^(\w+) output is still invalid/.exec(lines[0] ?? '');
  const issues = lines.filter((l) => l.startsWith('- '));
  const issue = issues.find((l) => !/^- \S*: \(advisory\) /.test(l)) ?? issues[0];
  if (!head || !issue) return lines[0] || 'the repair failed';
  const role = head[1]!;
  const agent = AGENT_NAMES[role as keyof typeof AGENT_NAMES] ?? role;
  const message = issue.replace(/^- (\$[^\s:]*: )?/, '');
  return `the ${agent} could not make a valid change: ${message}`;
}

const scriptOf = (spec: RepairableSpec, beatId: string) =>
  spec.script.find((s) => s.beatId === beatId);
const sceneOf = (spec: RepairableSpec, beatId: string) =>
  spec.scenes.find((s) => s.beatId === beatId);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One line per request: "b2 board: unchanged: the Generator could not…". */
export function outcomeLine(outcome: RepairRequestOutcome): string {
  const head = `${outcome.beatId} ${outcome.fields.join(', ')}: ${outcome.outcome}`;
  return outcome.reason ? `${head}: ${outcome.reason}` : head;
}
