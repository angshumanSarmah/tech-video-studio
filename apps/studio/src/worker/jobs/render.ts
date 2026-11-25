import { PROGRESS_DONE_PCT, SpecIdSchema } from '@explainer-studio/shared';
import { z } from 'zod';
import { recordMissingAssets } from '#core/assets/render-assets.ts';
import {
  beatDraftMetaPath,
  beatDraftPath,
  beatStillPath,
  exportSubtitlesPath,
  exportVideoPath,
  resolveDataPath,
  runDraftPath,
  stillsManifestPath,
} from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { recordExport } from '#core/db/repositories/exports.ts';
import type { Job } from '#core/db/repositories/jobs.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';
import { writeFinalCheck } from '#core/services/final-check.ts';
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

/**
 * Every render job is pinned to one `spec_versions` row of its run (`specVersionId`, the row id),
 * queued by whoever approved or requested that version: it renders exactly that version, even if
 * a newer one is saved before the job runs.
 */
const PinnedPayloadSchema = z.strictObject({ specVersionId: z.number().int().positive() });
const BeatDraftPayloadSchema = PinnedPayloadSchema.extend({ beatId: SpecIdSchema });
const RunPayloadSchema = PinnedPayloadSchema;

/**
 * The four render jobs. `job.run_id` names the run and `payload.specVersionId` the version.
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
      const { runId, input, tools } = load(deps, ctx);
      const { beatId } = ctx.payload;
      const result = await renderBeatDraft(
        input.target,
        beatId,
        tools,
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
      const { runId, input, tools } = load(deps, ctx);
      const result = await renderDraft(input.target, tools, toRun(ctx), draftPaths(deps, runId));
      recordMissingAssets(deps.dataDir, runId, input.missing);
      logResult(ctx, input, result);
      ctx.log('info', `Draft written to ${runDraftPath(runId)}.`);
      const blockers = finalRenderBlockers(input);
      writeFinalCheck(deps.dataDir, runId, { specVersionId: ctx.payload.specVersionId, blockers });
      for (const blocker of blockers) ctx.log('warn', `The final would be refused: ${blocker}`);
    },
  });
}

function finalJob(deps: RenderJobDeps) {
  return defineJobHandler({
    type: RENDER_JOB_TYPES.final,
    description:
      'Renders the whole video at the final preset, muxes the narration, writes the SRT and records the export.',
    payloadSchema: RunPayloadSchema,
    async run(ctx) {
      const { runId, input, tools } = load(deps, ctx);
      const blockers = finalRenderBlockers(input);
      if (blockers.length > 0) {
        throw new Error(`Final render refused:\n${blockers.map((b) => `  ${b}`).join('\n')}`);
      }
      const slug = exportSlug(input.context.topicTitle, runId);
      const rel = {
        video: exportVideoPath(runId, slug),
        subtitles: exportSubtitlesPath(runId, slug),
      };
      const abs = (path: string) => resolveDataPath(deps.dataDir, path);
      const result = await renderFinal(input.target, tools, toRun(ctx), {
        video: abs(rel.video),
        subtitles: abs(rel.subtitles),
      });
      // Only now that both files exist: the row makes the run undeletable.
      recordExport(deps.db, {
        runId,
        mp4Path: rel.video,
        srtPath: rel.subtitles,
        durationMs: Math.round(result.durationSec * 1000),
        title: input.target.spec.meta.title,
      });
      ctx.log(
        'info',
        `Final (spec v${input.specVersion}, ${result.frames} frames, ${result.cues} subtitle cues) written to ${rel.video} and ${rel.subtitles}.`,
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
      const { runId, input, tools } = load(deps, ctx);
      const abs = (rel: string) => resolveDataPath(deps.dataDir, rel);
      const paths = {
        still: (beatId: string) => abs(beatStillPath(runId, beatId)),
        manifest: abs(stillsManifestPath(runId)),
      };
      const frames = await renderStills(input.target, tools, toRun(ctx), paths);
      ctx.log(
        'info',
        `Stills for spec v${input.specVersion}: ${Object.keys(frames).length} beats.`,
      );
    },
  });
}

function load(deps: RenderJobDeps, ctx: JobContext<{ specVersionId: number }>) {
  const runId = requireRunId(ctx.job);
  const input = loadRunRenderInput(deps.db, deps.dataDir, runId, ctx.payload.specVersionId);
  for (const problem of input.problems) {
    ctx.log('warn', `Asset ${problem.id} failed to load: ${problem.message}`);
  }
  return { runId, input, tools: runTools(deps, runId) };
}

/** The process's render tools with the run's presets (its snapshot), so a run renders as it began. */
function runTools(deps: RenderJobDeps, runId: number): RenderTools {
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  const settings = { ...deps.tools.settings, presets: run.resolvedSettings.render.presets };
  return { ...deps.tools, settings };
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
