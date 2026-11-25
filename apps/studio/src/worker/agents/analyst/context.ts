import { describeBoard } from '@explainer-studio/renderer/catalog';
import {
  editDiff,
  validateRenderableVideoSpec,
  type AnalystCheckContext,
  type GateId,
} from '@explainer-studio/shared';
import { readDataJson } from '#core/data-files.ts';
import type { Executor } from '#core/db/client.ts';
import { getRunStep } from '#core/db/repositories/run-steps.ts';
import { getRun, type Run } from '#core/db/repositories/runs.ts';
import { getTopic } from '#core/db/repositories/topics.ts';
import { NotFoundError } from '#core/errors.ts';
import { readSpecVersion } from '#core/services/gates.ts';
import type { NotedDecision } from '#core/services/rule-proposals.ts';
import { listRules } from '#core/services/style-rules.ts';
import { boardLines } from '../curator/input.ts';
import type { AnalystInput } from './input.ts';

/**
 * What the Analyst reads about one gate decision (P1C.10), from the run's files: its topic, the
 * subject the decision was made on (and an edit's saved one), the beat it names and the rules
 * there are (rejected ones aside), plus what the answer's checks compare with.
 */

export interface AnalystContext {
  readonly run: Run;
  readonly input: AnalystInput;
  readonly check: AnalystCheckContext;
}

export function analystContext(
  db: Executor,
  dataDir: string,
  noted: NotedDecision,
): AnalystContext {
  const run = getRun(db, noted.runId);
  if (!run) throw new NotFoundError('run', noted.runId);
  const topic = getTopic(db, run.topicId);
  if (!topic) throw new NotFoundError('topic', run.topicId);
  const { decision, gate } = noted;
  const before = subjectContent(db, dataDir, gate, decision.subjectId);
  const after = subjectContent(db, dataDir, gate, decision.savedId);
  const beat = decision.beatId ? beatOf(before, decision.beatId) : undefined;
  const rules = listRules(db).filter((r) => r.status !== 'rejected');
  return {
    run,
    input: {
      gate,
      decision,
      topic: { title: topic.title, notes: topic.notes },
      ...(decision.action === 'edit' && before !== undefined && after !== undefined
        ? { changes: editDiff(withoutTiming(before), withoutTiming(after)) }
        : {}),
      ...(beat
        ? { beat: { id: decision.beatId!, content: beat, ...boardOf(before, decision.beatId!) } }
        : {}),
      existingRules: rules.map(({ id, scope, status, text }) => ({ id, scope, status, text })),
    },
    check: {
      topicTitle: topic.title,
      beatIds: beatIdsOf(before),
      existingRuleIds: rules.map((r) => r.id),
    },
  };
}

/** A gate's subject: a step's output (notes, plan) or a spec version. */
function subjectContent(
  db: Executor,
  dataDir: string,
  gate: GateId,
  id: number | undefined,
): unknown {
  if (id === undefined) return undefined;
  if (gate === 'scenes' || gate === 'draft') return readSpecVersion(db, dataDir, id);
  const step = getRunStep(db, id);
  return step?.outputPath ? readDataJson(dataDir, step.outputPath) : undefined;
}

type Shaped = {
  story?: { beats?: { id?: string; intent?: string }[] };
  script?: { beatId?: string }[];
  timing?: unknown;
};

/** Timing is code's (word times, the narration file): an edit's changes are what the person wrote. */
function withoutTiming(content: unknown): unknown {
  if (typeof content !== 'object' || content === null) return content;
  const rest: Record<string, unknown> = { ...(content as Record<string, unknown>) };
  delete rest.timing;
  return rest;
}

function beatIdsOf(content: unknown): string[] {
  const beats = (content as Shaped | undefined)?.story?.beats ?? [];
  return beats.flatMap((b) => (typeof b.id === 'string' ? [b.id] : []));
}

/** The beat's board as the Curator describes it, when the subject is a spec with boards. */
function boardOf(content: unknown, beatId: string): { board?: string[] } {
  const spec = validateRenderableVideoSpec(content);
  if (!spec.ok || !spec.spec.scenes.some((s) => s.beatId === beatId)) return {};
  return { board: boardLines(describeBoard(spec.spec, beatId)) };
}

/** The beat's plan intent and script, as the decision saw them. */
function beatOf(content: unknown, beatId: string): unknown {
  const shaped = content as Shaped | undefined;
  const intent = shaped?.story?.beats?.find((b) => b.id === beatId)?.intent;
  const script = shaped?.script?.find((s) => s.beatId === beatId);
  if (intent === undefined && script === undefined) return undefined;
  return { ...(intent !== undefined ? { intent } : {}), ...(script ? { script } : {}) };
}
