import { PROGRESS_DONE_PCT, SpecIdSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { recordMissingAssets } from '#core/assets/render-assets.ts';
import {
  beatDraftMetaPath,
  beatDraftPath,
  beatStillPath,
  exportVideoPath,
  resolveDataPath,
  runDraftPath,
} from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import type { Job } from '#core/db/repositories/jobs.ts';
import {
  renderBeatDraft,
  renderDraft,
  type DraftPaths,
  type DraftResult,
} from '../render/draft.ts';
import { renderFinal } from '../render/final.ts';
import {
  exportSlug,
  finalRenderBlockers,
  loadRunRenderInput,
  type RunRenderInput,
} from '../render/run-target.ts';
import { renderStills } from '../render/stills.ts';
import type { RenderRun, RenderTools } from '../render/target.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

/** Job types of the render service (P1A.12). Queued by the services that own each stage. */
export const RENDER_JOB_TYPES = {
  beatDraft: 'render_beat_draft',
  draft: 'render_draft',
  final: 'render_final',
  stills: 'render_stills',
} as const;

export interface RenderJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly tools: RenderTools;
}

const BeatDraftPayloadSchema = z.strictObject({ beatId: SpecIdSchema });
const RunPayloadSchema = z.strictObject({});

/**
 * The four render jobs. Each reads the run's newest spec version; `job.run_id` names the run.
 * Every output is written atomically and cached clips are reused, so a rerun after a crash or a
 * shutdown is safe (delivery is at-least-once).
 */
export function renderJobHandlers(deps: RenderJobDeps): JobHandler[] {
  return [beatDraftJob(deps), draftJob(deps), finalJob(deps), stillsJob(deps)];
}

function beatDraftJob(deps: RenderJobDeps) {
  return defineJobHandler({
    type: RENDER_JOB_TYPES.beatDraft,
    description: "Renders one beat's draft clip with its narration slice (cached by inputs).",
    payloadSchema: BeatDraftPayloadSchema,
    async run(ctx) {
      const { runId, input } = load(deps, ctx);
      const { beatId } = ctx.payload;
      const result = await renderBeatDraft(
        input.target,
        beatId,
        deps.tools,
        toRun(ctx),
        draftPaths(deps, runId),
      );
      recordMissingAssets(deps.dataDir, runId, input.missing, [beatId]);
      logResult(ctx, input, result);
    },
  });
}

function draftJob(deps: RenderJobDeps) {
  return defineJobHandler({
    type: RENDER_JOB_TYPES.draft,
    description: 'Renders changed beat clips, joins all clips and muxes the narration.',
    payloadSchema: RunPayloadSchema,
    async run(ctx) {
      const { runId, input } = load(deps, ctx);
      const result = await renderDraft(
        input.target,
        deps.tools,
        toRun(ctx),
        draftPaths(deps, runId),
      );
      recordMissingAssets(deps.dataDir, runId, input.missing);
      logResult(ctx, input, result);
      ctx.log('info', `Draft written to ${runDraftPath(runId)}.`);
    },
  });
}

function finalJob(deps: RenderJobDeps) {
  return defineJobHandler({
    type: RENDER_JOB_TYPES.final,
    description: 'Renders the whole video at the final preset and muxes the narration.',
    payloadSchema: RunPayloadSchema,
    async run(ctx) {
      const { runId, input } = load(deps, ctx);
      const blockers = finalRenderBlockers(input);
      if (blockers.length > 0) {
        throw new Error(`Final render refused:\n${blockers.map((b) => `  ${b}`).join('\n')}`);
      }
      const relPath = exportVideoPath(runId, exportSlug(input.context.topicTitle, runId));
      const { frames } = await renderFinal(
        input.target,
        deps.tools,
        toRun(ctx),
        resolveDataPath(deps.dataDir, relPath),
      );
      ctx.log(
        'info',
        `Final (spec v${input.specVersion}, ${frames} frames) written to ${relPath}.`,
      );
    },
  });
}

function stillsJob(deps: RenderJobDeps) {
  return defineJobHandler({
    type: RENDER_JOB_TYPES.stills,
    description: 'Renders one preview still per beat at its key frame.',
    payloadSchema: RunPayloadSchema,
    // Previews only: a failure must not fail the run.
    failsRun: false,
    async run(ctx) {
      const { runId, input } = load(deps, ctx);
      const path = (beatId: string) => resolveDataPath(deps.dataDir, beatStillPath(runId, beatId));
      const frames = await renderStills(input.target, deps.tools, toRun(ctx), path);
      ctx.log(
        'info',
        `Stills for spec v${input.specVersion}: ${Object.keys(frames).length} beats.`,
      );
    },
  });
}

function load(deps: RenderJobDeps, ctx: JobContext<unknown>) {
  const runId = requireRunId(ctx.job);
  const input = loadRunRenderInput(deps.db, deps.dataDir, runId);
  for (const problem of input.problems) {
    ctx.log('warn', `Asset ${problem.id} failed to load: ${problem.message}`);
  }
  return { runId, input };
}

function requireRunId(job: Job): number {
  if (job.runId === null) throw new Error(`${job.type} needs a run (job ${job.id} has none).`);
  return job.runId;
}

function draftPaths(deps: RenderJobDeps, runId: number): DraftPaths {
  const abs = (rel: string) => resolveDataPath(deps.dataDir, rel);
  return {
    clip: (beatId) => abs(beatDraftPath(runId, beatId)),
    meta: (beatId) => abs(beatDraftMetaPath(runId, beatId)),
    joined: abs(runDraftPath(runId)),
  };
}

function toRun(ctx: JobContext<unknown>): RenderRun {
  return {
    signal: ctx.signal,
    onProgress: (fraction, message) =>
      ctx.progress(Math.min(1, Math.max(0, fraction)) * PROGRESS_DONE_PCT, message),
  };
}

function logResult(ctx: JobContext<unknown>, input: RunRenderInput, result: DraftResult): void {
  const rendered = result.rendered.length > 0 ? result.rendered.join(', ') : 'none';
  ctx.log(
    'info',
    `Spec v${input.specVersion}: rendered ${rendered}; reused ${result.reused.length} cached clip(s).`,
  );
}
