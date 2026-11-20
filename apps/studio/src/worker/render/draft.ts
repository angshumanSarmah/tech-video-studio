import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  beatFrameSpans,
  totalFrames,
  type BeatFrameSpan,
} from '@explainer-studio/renderer/catalog';
import { effectiveTiming } from '@explainer-studio/shared';
import { audioSliceHash } from './audio.ts';
import { draftClipKey, readClipMeta, type DraftClipMeta } from './draft-cache.ts';
import { withSession, type RenderSession } from './engine.ts';
import { concatArgs, concatListText, muxArgs } from './ffmpeg-args.ts';
import {
  compositionProps,
  siblingPath,
  writeAtomically,
  type RenderRun,
  type RenderTarget,
  type RenderTools,
} from './target.ts';

/** Where draft outputs go (absolute paths). */
export interface DraftPaths {
  readonly clip: (beatId: string) => string;
  readonly meta: (beatId: string) => string;
  /** The joined draft (`render_draft` only). */
  readonly joined: string;
}

export interface DraftResult {
  /** Beats rendered in this job, in story order. */
  readonly rendered: string[];
  /** Beats whose cached clip was still fresh. */
  readonly reused: string[];
  /** Frames of the whole draft (the sum of its clips). */
  readonly frames: number;
}

/** A beat clip to render or reuse: its span at the draft fps and its cache key. */
type ClipPlan = { span: BeatFrameSpan; key: string; fresh: boolean };

/** Share of a joined draft's progress spent on clips; the rest is the join and mux. */
const CLIPS_SHARE = 0.95;

/**
 * Renders one beat's draft clip (`BeatFromSpec`, transitions into it shown as cuts, with the
 * draft badge) with its own slice of the narration, unless its cached clip is still fresh.
 */
export async function renderBeatDraft(
  target: RenderTarget,
  beatId: string,
  tools: RenderTools,
  run: RenderRun,
  paths: DraftPaths,
): Promise<DraftResult> {
  const plans = await planClips(target, tools, paths);
  const plan = plans.find((p) => p.span.beatId === beatId);
  if (!plan) throw new Error(`Unknown beat "${beatId}".`);
  if (!plan.fresh) {
    await withSession(tools.engine, (session) =>
      renderClip(target, plan, tools, session, run, paths, (f) => run.onProgress(f)),
    );
  }
  run.onProgress(1);
  const frames = plan.span.durationInFrames;
  return plan.fresh
    ? { rendered: [], reused: [beatId], frames }
    : { rendered: [beatId], reused: [], frames };
}

/**
 * Renders every missing or changed beat clip, then joins all clips (video copied, no
 * re-encode) and lays the whole narration under the result from 0 s. Editing one beat re-renders
 * only the clips whose inputs changed (`draftClipKey`).
 */
export async function renderDraft(
  target: RenderTarget,
  tools: RenderTools,
  run: RenderRun,
  paths: DraftPaths,
): Promise<DraftResult> {
  const plans = await planClips(target, tools, paths);
  const total = assertTiles(target, tools, plans);
  const stale = plans.filter((p) => !p.fresh);
  if (stale.length > 0) {
    await withSession(tools.engine, (session) =>
      renderStale(target, plans, tools, session, run, paths, total),
    );
  }
  run.onProgress(CLIPS_SHARE, 'joining clips');
  await joinClips(target, plans, tools, run, paths, total);
  run.onProgress(1);
  return {
    rendered: stale.map((p) => p.span.beatId),
    reused: plans.filter((p) => p.fresh).map((p) => p.span.beatId),
    frames: total,
  };
}

async function planClips(
  target: RenderTarget,
  tools: RenderTools,
  paths: DraftPaths,
): Promise<ClipPlan[]> {
  const preset = tools.settings.presets.draft;
  const engineIdentity = await tools.engine.identity();
  const wav = target.audioPath ? readFileSync(target.audioPath) : null;
  const spans = beatFrameSpans(effectiveTiming(target.spec), preset.fps);
  return spans.map((span) => {
    const { startSec, durationSec } = spanSeconds(span, preset.fps);
    const audioHash = wav ? audioSliceHash(wav, startSec, durationSec) : null;
    const key = draftClipKey({ target, beatId: span.beatId, preset, engineIdentity, audioHash });
    const meta = readClipMeta(paths.clip(span.beatId), paths.meta(span.beatId));
    return { span, key, fresh: isFresh(meta, key, span, preset.fps) };
  });
}

function isFresh(meta: DraftClipMeta | undefined, key: string, span: BeatFrameSpan, fps: number) {
  return meta?.key === key && meta.frames === span.durationInFrames && meta.fps === fps;
}

/** Beat spans must tile the video exactly, or joined clips would drift from the narration. */
function assertTiles(target: RenderTarget, tools: RenderTools, plans: readonly ClipPlan[]) {
  const fps = tools.settings.presets.draft.fps;
  const total = totalFrames(effectiveTiming(target.spec), fps);
  const sum = plans.reduce((n, p) => n + p.span.durationInFrames, 0);
  if (sum !== total) {
    throw new Error(`Beat clips cover ${sum} frames but the video has ${total}; refusing to join.`);
  }
  return total;
}

async function renderStale(
  target: RenderTarget,
  plans: readonly ClipPlan[],
  tools: RenderTools,
  session: RenderSession,
  run: RenderRun,
  paths: DraftPaths,
  total: number,
): Promise<void> {
  let done = plans.filter((p) => p.fresh).reduce((n, p) => n + p.span.durationInFrames, 0);
  for (const plan of plans.filter((p) => !p.fresh)) {
    const { beatId, durationInFrames } = plan.span;
    const report = (f: number) =>
      run.onProgress(((done + f * durationInFrames) / total) * CLIPS_SHARE, `beat ${beatId}`);
    await renderClip(target, plan, tools, session, run, paths, report);
    done += durationInFrames;
  }
}

/** Renders a silent clip, muxes its narration slice, then writes its sidecar (in that order). */
async function renderClip(
  target: RenderTarget,
  plan: ClipPlan,
  tools: RenderTools,
  session: RenderSession,
  run: RenderRun,
  paths: DraftPaths,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const preset = tools.settings.presets.draft;
  const { beatId } = plan.span;
  const { startSec, durationSec } = spanSeconds(plan.span, preset.fps);
  const clip = paths.clip(beatId);
  const silent = siblingPath(clip, 'video');
  await writeAtomically(silent, async (out) => {
    await session.renderVideo({
      compositionId: 'BeatFromSpec',
      inputProps: compositionProps(target, preset, { beatId, draft: true }),
      preset,
      mode: 'draft',
      concurrency: tools.settings.concurrency,
      outPath: out,
      signal: run.signal,
      onProgress,
    });
  });
  const audio = target.audioPath ? { path: target.audioPath, startSec } : null;
  try {
    await mux(tools, run, { videoPath: silent, audio, durationSec, outPath: clip });
  } finally {
    rmSync(silent, { force: true });
  }
  const meta: DraftClipMeta = {
    key: plan.key,
    frames: plan.span.durationInFrames,
    fps: preset.fps,
  };
  writeFileSync(paths.meta(beatId), `${JSON.stringify(meta, null, 2)}\n`);
}

async function joinClips(
  target: RenderTarget,
  plans: readonly ClipPlan[],
  tools: RenderTools,
  run: RenderRun,
  paths: DraftPaths,
  total: number,
): Promise<void> {
  const listPath = siblingPath(paths.joined, 'list').replace(/\.mp4$/, '.txt');
  writeFileSync(listPath, concatListText(plans.map((p) => paths.clip(p.span.beatId))));
  const silent = siblingPath(paths.joined, 'video');
  try {
    await writeAtomically(silent, async (out) => {
      await tools.ffmpeg(concatArgs(listPath, out), run.signal);
    });
    const audio = target.audioPath ? { path: target.audioPath, startSec: 0 } : null;
    const durationSec = total / tools.settings.presets.draft.fps;
    await mux(tools, run, { videoPath: silent, audio, durationSec, outPath: paths.joined });
  } finally {
    rmSync(silent, { force: true });
    rmSync(listPath, { force: true });
  }
}

/** Muxes narration under a silent video into `outPath`, atomically. */
export async function mux(
  tools: RenderTools,
  run: RenderRun,
  args: {
    videoPath: string;
    audio: { path: string; startSec: number } | null;
    durationSec: number;
    outPath: string;
  },
): Promise<void> {
  await writeAtomically(args.outPath, async (out) => {
    await tools.ffmpeg(muxArgs({ ...args, outPath: out }), run.signal);
  });
}

/** A span in seconds on the narration track, exactly as its frames cover it. */
export function spanSeconds(span: BeatFrameSpan, fps: number) {
  return { startSec: span.from / fps, durationSec: span.durationInFrames / fps };
}
