import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSubtitleCues, totalFrames } from '@explainer-studio/renderer/catalog';
import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { DEFAULT_THEME_ID, getTheme } from '@explainer-studio/renderer/theme';
import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMissingAssets } from '#core/assets/render-assets.ts';
import {
  beatStillPath,
  exportSubtitlesPath,
  exportVideoPath,
  beatDraftMetaPath,
  resolveDataPath,
  runDraftPath,
  specVersionPath,
  stillsManifestPath,
  writeDataJson,
  writeDataText,
} from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob } from '#core/db/repositories/jobs.ts';
import { listRunExports } from '#core/db/repositories/exports.ts';
import { createRun, deleteRun, getRun, RunHasExportsError } from '#core/db/repositories/runs.ts';
import { createSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { createTestDb, TEST_APP_SETTINGS, type TestDb } from '#core/db/testing.ts';
import { DraftClipMetaSchema } from '../render/draft-cache.ts';
import {
  DraftManifestSchema,
  FinalManifestSchema,
  readManifest,
  StillsManifestSchema,
} from '../render/manifests.ts';
import { exportSlug, finalRenderBlockers, loadRunRenderInput } from '../render/run-target.ts';
import { formatSrt } from '../render/srt.ts';
import { fakeTools, makeWav } from '../render/testing.ts';
import { runNextJob } from '../runner.ts';
import { createJobRegistry } from './registry.ts';
import { RENDER_JOB_TYPES, renderJobHandlers } from './render.ts';

let t: TestDb;
let runId: number;

beforeEach(() => {
  t = createTestDb();
  // Ahead of real time, so jobs enqueued with SQLite's clock are already due.
  vi.useFakeTimers({ now: Date.now() + 60_000 });
  const topicId = createTopic(t.db, { title: 'How a Rate Limiter Works!' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  runId = createRun(t.db, { app: TEST_APP_SETTINGS, topicId, seriesId }).id;
});

afterEach(() => {
  vi.useRealTimers();
  t.cleanup();
});

/** Saves a spec version of the run; returns its `spec_versions` row id. */
function saveSpec(spec: unknown, version = 1, forRun = runId): number {
  const jsonPath = writeDataJson(t.dataDir, specVersionPath(forRun, version), spec);
  return createSpecVersion(t.db, { runId: forRun, version, jsonPath, createdBy: 'agent' }).id;
}

/** The fixture with real timing (its estimate) and a narration file in the data dir. */
function timedSpec(): RenderableVideoSpec {
  const audioFile = `runs/${runId}/narration.wav`;
  writeDataText(t.dataDir, audioFile, '');
  writeFileSync(resolveDataPath(t.dataDir, audioFile), makeWav([0, 0, 0, 0]));
  return {
    ...rateLimiterSpec,
    timing: { audioFile, beats: effectiveTiming(rateLimiterSpec).beats, events: [] },
  };
}

/** The fixture with the payoff tag's text edited (a user edit at the scenes gate). */
function editedPayoff(spec: RenderableVideoSpec = rateLimiterSpec): RenderableVideoSpec {
  const scenes = spec.scenes.map((s) =>
    s.beatId === 'payoff'
      ? { ...s, elements: s.elements.map((e) => ({ ...e, props: { text: 'slowed down' } })) }
      : s,
  );
  return { ...spec, scenes };
}

function queue(type: string, payload: Record<string, unknown>) {
  return enqueueJob(t.db, { type, runId, payload });
}

/** Runs the next queued job with fake render tools. */
async function runQueued(jobId: number) {
  const fake = fakeTools();
  const registry = createJobRegistry(
    renderJobHandlers({ db: t.db, dataDir: t.dataDir, tools: fake.tools }),
  );
  await runNextJob({
    db: t.db,
    registry,
    workerId: 'test:1',
    signal: new AbortController().signal,
  });
  const events = listEventsSince(t.db, { jobId, afterId: 0, limit: 500 });
  return { job: getJob(t.db, jobId)!, events, fake };
}

const runJob = (type: string, payload: Record<string, unknown>) =>
  runQueued(queue(type, payload).id);

const logs = (events: { type: string; payload: unknown }[]) =>
  events.filter((e) => e.type === 'log').map((e) => (e.payload as { message: string }).message);

/** The payoff tag text each rendered video was drawn with. */
const payoffTexts = (videos: { inputProps: Record<string, unknown> }[]) =>
  videos.map((v) => {
    const spec = v.inputProps.spec as RenderableVideoSpec;
    return spec.scenes.find((s) => s.beatId === 'payoff')?.elements[0]?.props;
  });

const data = (rel: string) => resolveDataPath(t.dataDir, rel);

describe('render jobs', () => {
  it('render_draft renders every beat, joins them and records missing assets', async () => {
    const specVersionId = saveSpec(rateLimiterSpec);
    const { job, events } = await runJob(RENDER_JOB_TYPES.draft, { specVersionId });
    expect(job.status).toBe('done');
    expect(existsSync(data(runDraftPath(runId)))).toBe(true);
    expect(logs(events)[0]).toMatch(/rendered hook, bucket-intro, bucket-empty, payoff/);
    expect(events.some((e) => e.type === 'progress')).toBe(true);
    expect(readMissingAssets(t.dataDir, runId)).toEqual([]);
  });

  it('render_draft of a one-beat edit re-renders only that beat', async () => {
    await runJob(RENDER_JOB_TYPES.draft, { specVersionId: saveSpec(rateLimiterSpec) });
    const v2 = saveSpec(editedPayoff(), 2);
    const { events, fake } = await runJob(RENDER_JOB_TYPES.draft, { specVersionId: v2 });
    expect(fake.engine.videos.map((v) => v.inputProps.beatId)).toEqual(['payoff']);
    expect(logs(events)[0]).toMatch(/^Spec v2: rendered payoff; reused 3 cached clip\(s\)\./);
  });

  it('render_beat_draft renders one beat', async () => {
    const specVersionId = saveSpec(rateLimiterSpec);
    const payload = { specVersionId, beatId: 'bucket-empty' };
    const { job, fake } = await runJob(RENDER_JOB_TYPES.beatDraft, payload);
    expect(job.status).toBe('done');
    expect(fake.engine.videos.map((v) => v.inputProps.beatId)).toEqual(['bucket-empty']);
  });

  it('render_final refuses a spec without narration timing', async () => {
    const specVersionId = saveSpec(rateLimiterSpec);
    const { job, fake } = await runJob(RENDER_JOB_TYPES.final, { specVersionId });
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Final render refused:\n {2}The spec has no narration timing/);
    expect(fake.engine.videos).toEqual([]);
  });

  it('render_final writes exports/<id>/<slug>.mp4 for a timed spec', async () => {
    const specVersionId = saveSpec(timedSpec());
    const { job, fake } = await runJob(RENDER_JOB_TYPES.final, { specVersionId });
    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    const out = exportVideoPath(runId, 'how-a-rate-limiter-works');
    expect(existsSync(data(out))).toBe(true);
    expect(fake.engine.videos[0]?.preset).toEqual({ width: 1080, height: 1920, fps: 30 });
  });

  it('render_final writes the SRT next to the video and records one export row', async () => {
    const spec = timedSpec();
    const specVersionId = saveSpec(spec);
    const slug = 'how-a-rate-limiter-works';
    const srt = exportSubtitlesPath(runId, slug);
    const { job } = await runJob(RENDER_JOB_TYPES.final, { specVersionId });
    expect(job.status).toBe('done');
    expect(readFileSync(data(srt), 'utf8')).toBe(
      formatSrt(buildSubtitleCues(spec, getTheme(DEFAULT_THEME_ID))),
    );

    const frames = totalFrames(effectiveTiming(spec), 30);
    const [row] = listRunExports(t.db, runId);
    expect(row).toMatchObject({
      runId,
      mp4Path: exportVideoPath(runId, slug),
      srtPath: srt,
      durationMs: Math.round((frames / 30) * 1000),
      costUsd: 0,
      title: spec.meta.title,
    });
    expect(() => deleteRun(t.db, runId)).toThrow(RunHasExportsError);

    // At-least-once delivery: a rerun refreshes the row instead of adding one.
    await runJob(RENDER_JOB_TYPES.final, { specVersionId });
    expect(listRunExports(t.db, runId)).toHaveLength(1);
  });

  it('render_final records no export when the render fails', async () => {
    const specVersionId = saveSpec(rateLimiterSpec);
    await runJob(RENDER_JOB_TYPES.final, { specVersionId });
    expect(listRunExports(t.db, runId)).toEqual([]);
    expect(deleteRun(t.db, runId)).toBe(true);
  });

  it('render_stills writes one PNG per beat and does not fail the run on error', async () => {
    const specVersionId = saveSpec(rateLimiterSpec);
    const { job } = await runJob(RENDER_JOB_TYPES.stills, { specVersionId });
    expect(job.status).toBe('done');
    expect(existsSync(data(beatStillPath(runId, 'payoff')))).toBe(true);
    const handler = renderJobHandlers({ db: t.db, dataDir: t.dataDir, tools: fakeTools().tools });
    expect(handler.find((h) => h.type === RENDER_JOB_TYPES.stills)?.failsRun).toBe(false);
  });
});

describe('pinned spec versions', () => {
  it('a newer saved version does not change what a pinned draft job renders', async () => {
    const v1 = saveSpec(rateLimiterSpec);
    const queued = queue(RENDER_JOB_TYPES.draft, { specVersionId: v1 });
    const v2 = saveSpec(editedPayoff(), 2); // saved after the job was queued
    const { job, events, fake } = await runQueued(queued.id);

    expect(job.status).toBe('done');
    expect(payoffTexts(fake.engine.videos)).toEqual(Array(4).fill({ text: 'rate limited' }));
    expect(logs(events)[0]).toMatch(/^Spec v1: /);
    const source = { specVersionId: v1, version: 1 };
    const manifest = readManifest(DraftManifestSchema, data('runs/' + runId + '/draft.json'));
    expect(manifest.source).toEqual(source);
    expect(manifest.clips.every((c) => c.source?.specVersionId === v1)).toBe(true);
    expect(v2).not.toBe(v1);
  });

  it('a newer saved version does not change what a pinned final job renders', async () => {
    const v1 = saveSpec(timedSpec());
    const queued = queue(RENDER_JOB_TYPES.final, { specVersionId: v1 });
    saveSpec(editedPayoff(timedSpec()), 2);
    const { job, fake } = await runQueued(queued.id);

    expect(job.status).toBe('done');
    expect(payoffTexts(fake.engine.videos)).toEqual([{ text: 'rate limited' }]);
    const sidecar = data(
      exportVideoPath(runId, 'how-a-rate-limiter-works').replace(/mp4$/, 'json'),
    );
    expect(readManifest(FinalManifestSchema, sidecar).source).toEqual({
      specVersionId: v1,
      version: 1,
    });
  });

  it('stills record the version they show', async () => {
    const v1 = saveSpec(rateLimiterSpec);
    const queued = queue(RENDER_JOB_TYPES.stills, { specVersionId: v1 });
    saveSpec(editedPayoff(), 2);
    await runQueued(queued.id);
    const manifest = readManifest(StillsManifestSchema, data(stillsManifestPath(runId)));
    expect(manifest.source).toEqual({ specVersionId: v1, version: 1 });
    expect(Object.keys(manifest.frames)).toEqual([
      'hook',
      'bucket-intro',
      'bucket-empty',
      'payoff',
    ]);
  });

  it('reused clips keep the version they were made from', async () => {
    const v1 = saveSpec(rateLimiterSpec);
    await runJob(RENDER_JOB_TYPES.draft, { specVersionId: v1 });
    const v2 = saveSpec(editedPayoff(), 2);
    await runJob(RENDER_JOB_TYPES.draft, { specVersionId: v2 });

    const manifest = readManifest(DraftManifestSchema, data(`runs/${runId}/draft.json`));
    expect(manifest.source).toEqual({ specVersionId: v2, version: 2 });
    expect(manifest.clips.map((c) => [c.beatId, c.source?.version])).toEqual([
      ['hook', 1],
      ['bucket-intro', 1],
      ['bucket-empty', 1],
      ['payoff', 2],
    ]);
    const sidecar = readManifest(DraftClipMetaSchema, data(beatDraftMetaPath(runId, 'payoff')));
    expect(sidecar.source).toEqual({ specVersionId: v2, version: 2 });
  });

  it('fails clearly when the version belongs to another run', async () => {
    const topicId = createTopic(t.db, { title: 'Other' }).id;
    const other = createRun(t.db, {
      app: TEST_APP_SETTINGS,
      topicId,
      seriesId: getRun(t.db, runId)!.seriesId,
    }).id;
    const foreign = saveSpec(rateLimiterSpec, 1, other);
    const { job, fake } = await runJob(RENDER_JOB_TYPES.draft, { specVersionId: foreign });
    expect(job.status).toBe('failed');
    expect(job.error).toBe(`Spec version ${foreign} belongs to run ${other}, not run ${runId}.`);
    expect(fake.engine.videos).toEqual([]);
  });

  it('fails clearly for an unknown version', async () => {
    const { job } = await runJob(RENDER_JOB_TYPES.final, { specVersionId: 999 });
    expect(job.error).toBe('Spec version 999 does not exist.');
  });

  it.each(Object.values(RENDER_JOB_TYPES))('%s requires specVersionId', async (type) => {
    saveSpec(rateLimiterSpec);
    const payload = type === RENDER_JOB_TYPES.beatDraft ? { beatId: 'payoff' } : {};
    const { job } = await runJob(type, payload);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/invalid payload[\s\S]*specVersionId/);
  });
});

describe('loadRunRenderInput', () => {
  it('resolves series, handle, assets and narration for the newest spec version', () => {
    const id = saveSpec(timedSpec());
    const input = loadRunRenderInput(t.db, t.dataDir, runId, id);
    expect(input.specVersion).toBe(1);
    expect(input.target.source).toEqual({ specVersionId: id, version: 1 });
    expect(input.target.props.series).toEqual({ label: 'SYSTEM DESIGN', accentColour: '#4F8CFF' });
    expect(input.target.audioPath).toBe(resolveDataPath(t.dataDir, `runs/${runId}/narration.wav`));
    expect(finalRenderBlockers(input)).toEqual([]);
  });

  it('refuses a timed spec whose narration file is missing', () => {
    const spec = timedSpec();
    const id = saveSpec({
      ...spec,
      timing: { ...spec.timing, audioFile: `runs/${runId}/gone.wav` },
    });
    expect(() => loadRunRenderInput(t.db, t.dataDir, runId, id)).toThrow(
      `Narration file runs/${runId}/gone.wav is missing`,
    );
  });

  it('throws every structured error for an unrenderable spec', () => {
    const id = saveSpec({ ...rateLimiterSpec, scenes: undefined });
    expect(() => loadRunRenderInput(t.db, t.dataDir, runId, id)).toThrow(
      /Spec v1 is not renderable:\n {2}\$\.scenes/,
    );
  });

  it('lists registry errors, unknown assets and missing logos as final blockers', () => {
    const scenes = rateLimiterSpec.scenes.map((s, i) =>
      i === 0
        ? {
            ...s,
            elements: [
              ...s.elements,
              { id: 'ghost', primitive: 'no_such_primitive', props: {} },
              { id: 'odd-icon', primitive: 'icon', props: { asset: 'no-such-asset' } },
            ],
          }
        : s,
    );
    const id = saveSpec({ ...timedSpec(), scenes });
    const blockers = finalRenderBlockers(loadRunRenderInput(t.db, t.dataDir, runId, id));
    expect(blockers.some((b) => b.includes('[unknown_reference]'))).toBe(true);
    expect(blockers.some((b) => b.includes('[unknown_asset]'))).toBe(true);
    expect(blockers.some((b) => b.startsWith('Missing asset no-such-asset'))).toBe(true);
  });
});

describe('exportSlug', () => {
  it.each([
    ['How a Rate Limiter Works!', 'how-a-rate-limiter-works'],
    ['Café — LRU vs LFU', 'cafe-lru-vs-lfu'],
    ['???', 'run-7'],
  ])('%s -> %s', (title, slug) => {
    expect(exportSlug(title, 7)).toBe(slug);
  });
});
