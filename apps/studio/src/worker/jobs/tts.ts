import {
  PROGRESS_DONE_PCT,
  validateVideoSpec,
  type BeatScript,
  type Stage,
  type TimingSettings,
  type TtsSettings,
  type VideoSpec,
} from '@explainer-studio/shared';
import { z } from 'zod';
import { readDataJson } from '#core/data-files.ts';
import type { Db } from '#core/db/client.ts';
import { getRun } from '#core/db/repositories/runs.ts';
import { NotFoundError } from '#core/errors.ts';
import { pinnedSpecVersion, saveSpecVersion } from '#core/services/spec-versions.ts';
import { resolveTimingOptions } from '../timing/assemble.ts';
import { formatSpecIssues, synthesizeScript, timedSpec } from '../timing/narrate.ts';
import { resolveTtsOptions } from '../tts/options.ts';
import type { TtsProvider } from '../tts/provider.ts';
import { defineJobHandler, type JobContext, type JobHandler } from './handler.ts';

export const TTS_JOB_TYPE = 'tts' satisfies Stage;

export interface TtsJobDeps {
  readonly db: Db;
  readonly dataDir: string;
  readonly tts: TtsProvider;
  /** App defaults (`settings.tts`, `settings.timing`); the run's settings override them. */
  readonly settings: { readonly tts: TtsSettings; readonly timing: TimingSettings };
}

const PayloadSchema = z.strictObject({ specVersionId: z.number().int().positive() });
type Ctx = JobContext<z.output<typeof PayloadSchema>>;

/**
 * Narrates a pinned spec version and saves it re-timed as the run's next version: synthesises
 * each beat (cached, so a rerun or a re-time after the Generator synthesises nothing new), runs
 * the timing step with the run's pauses (landing holds once the spec has scenes), writes the
 * narration track and validates the timed spec. Idempotent: the track is content-addressed and
 * an unchanged spec is not saved twice. `ctx.signal` reaches the TTS process (an abort kills it).
 */
export function ttsJobHandler(deps: TtsJobDeps): JobHandler {
  return defineJobHandler({
    type: TTS_JOB_TYPE,
    description: 'Synthesise narration per beat and save the spec with its timing layer.',
    payloadSchema: PayloadSchema,
    run: (ctx) => narrate(deps, ctx),
  });
}

async function narrate(deps: TtsJobDeps, ctx: Ctx): Promise<void> {
  const runId = ctx.job.runId;
  if (runId === null) throw new Error('A tts job needs a run.');
  const run = getRun(deps.db, runId);
  if (!run) throw new NotFoundError('run', runId);
  const pinned = pinnedSpecVersion(deps.db, runId, ctx.payload.specVersionId);
  const spec = scriptedSpec(readDataJson(deps.dataDir, pinned.jsonPath), pinned.version);
  const options = resolveTtsOptions(run.settings, deps.settings.tts);
  const pauses = resolveTimingOptions(run.settings, deps.settings.timing);

  const beats = await synthesizeScript(
    deps.tts,
    spec.script,
    options,
    ctx.signal,
    (id, i, cached) =>
      ctx.progress(
        Math.round(((i + 1) / spec.script.length) * 90),
        `Beat ${id}${cached ? ' (cached)' : ''}`,
      ),
  );
  const timed = timedSpec(deps.dataDir, runId, spec, beats, pauses);
  const timedSpecValue = timed.spec;
  const saved = saveSpecVersion(deps.db, deps.dataDir, {
    runId,
    spec: timedSpecValue,
    createdBy: 'agent',
    note:
      `Timed from v${pinned.version}: ${options.voice} at ${options.speed}x, ` +
      `gap ${pauses.beatGapSec}s, landing ${pauses.landingSec}s, tail ${pauses.endTailSec}s.`,
  });
  const what = saved.created ? 'Saved' : 'Unchanged, kept';
  ctx.log('info', `${what} spec v${saved.version.version} (${timed.endSec}s of narration).`);
  ctx.progress(PROGRESS_DONE_PCT, 'Narration timed');
}

type ScriptedSpec = VideoSpec & { script: BeatScript[] };

function scriptedSpec(raw: unknown, version: number): ScriptedSpec {
  const result = validateVideoSpec(raw);
  if (!result.ok)
    throw new Error(`Spec v${version} is invalid:\n${formatSpecIssues(result.errors)}`);
  const { script } = result.spec;
  if (!script?.length) throw new Error(`Spec v${version} has no script to narrate.`);
  return { ...result.spec, script };
}
