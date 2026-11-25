import { directorCatalogueBlock } from '@explainer-studio/renderer/catalog';
import {
  AvoidNameSchema,
  backlogItems,
  builtInsSection,
  DEFAULT_VIDEO_SETTINGS,
  referenceDevices,
  referenceRecordProblems,
  ReferenceRecordSchema,
} from '@explainer-studio/shared';
import { z } from 'zod';
import type { Db } from '#core/db/client.ts';
import { getReference } from '#core/db/repositories/references.ts';
import { NotFoundError } from '#core/errors.ts';
import {
  ANALYZE_REFERENCE_JOB_TYPE,
  markReferenceFailed,
  readReferenceBreakdown,
  referenceCheckContext,
  saveReferenceRecord,
  withNames,
} from '#core/services/references.ts';
import { referenceUserMessage } from '../agents/reference/input.ts';
import { buildPrompt } from '../agents/prompt-builder.ts';
import type { PromptTemplates } from '../agents/prompts/templates.ts';
import type { LlmClient } from '../llm/client.ts';
import { defineJobHandler, type JobContext } from './handler.ts';

export interface AnalyzeReferenceJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly llm: LlmClient;
  readonly prompts: PromptTemplates;
}

const PayloadSchema = z.strictObject({
  referenceId: z.number().int().positive(),
  /** Names the person gave (or the record had before a reanalysis), merged into the record. */
  namesToAvoid: z.array(AvoidNameSchema).optional(),
});
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * The Reference analyst (P1C.11): a pasted breakdown becomes a structure-only record, repaired
 * until `referenceRecordProblems` passes (catalogue ids, no quoted wording, digits or names),
 * then saved with its backlog rows. The job belongs to no run (`run_id` null): the call is
 * outside any run's cost cap, and its failure fails nothing else; the reference is marked
 * `failed` with the reason. Screenshots never reach the model. A reference that is no longer
 * `pending` (already analysed: at-least-once delivery) is left as it is.
 */
export function analyzeReferenceJobHandler(deps: AnalyzeReferenceJobDeps) {
  let catalogue: string | undefined;
  const catalogueBlock = () =>
    (catalogue ??= `${directorCatalogueBlock()}\n\n${builtInsSection()}`);
  return defineJobHandler({
    type: ANALYZE_REFERENCE_JOB_TYPE,
    description: 'Turns a pasted reference breakdown into a structure-only record.',
    payloadSchema: PayloadSchema,
    failsRun: false,
    run: (ctx) => analyze(deps, catalogueBlock, ctx),
  });
}

async function analyze(deps: AnalyzeReferenceJobDeps, catalogue: () => string, ctx: Ctx) {
  const { referenceId } = ctx.payload;
  const row = getReference(deps.db, referenceId);
  if (!row) throw new NotFoundError('Reference', referenceId);
  if (row.status !== 'pending') {
    ctx.log('info', `Reference ${row.slug} is ${row.status}: nothing to analyse.`);
    return;
  }
  const names = ctx.payload.namesToAvoid ?? [];
  const breakdown = readReferenceBreakdown(deps.dataDir, row);
  const checkCtx = referenceCheckContext({ breakdown, extraNames: names });
  try {
    const prompt = buildPrompt(deps.prompts, {
      role: 'reference',
      variables: DEFAULT_VIDEO_SETTINGS,
      catalogue: catalogue(),
      input: referenceUserMessage(breakdown, names),
    });
    const result = await deps.llm.callJson({
      role: 'reference',
      prompt,
      schema: ReferenceRecordSchema,
      check: (value) => referenceRecordProblems(value, checkCtx),
      signal: ctx.signal,
      log: ctx.log,
    });
    const record = withNames(result.value, names);
    const { added } = deps.db.transaction((tx) =>
      saveReferenceRecord(tx, deps.dataDir, row, record),
    );
    ctx.log('info', `Reference ${row.slug} ready: ${summary(record)}`);
    for (const item of added) ctx.log('info', `Backlog: ${item.name}: ${item.description}`);
  } catch (error) {
    if (!ctx.signal.aborted) {
      markReferenceFailed(deps.db, row.id, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

function summary(record: z.output<typeof ReferenceRecordSchema>): string {
  const missing = backlogItems(record).length;
  return (
    `${record.topicClass}, ${record.beats.length} beats, hook ${record.hook.kind}/${record.hook.device}; ` +
    `devices ${referenceDevices(record).join(', ')}; ${missing} backlog item${missing === 1 ? '' : 's'}`
  );
}
