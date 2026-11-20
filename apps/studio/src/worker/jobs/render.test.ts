import { existsSync, writeFileSync } from 'node:fs';
import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import { effectiveTiming, type RenderableVideoSpec } from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMissingAssets } from '#core/assets/render-assets.ts';
import {
  beatStillPath,
  exportVideoPath,
  resolveDataPath,
  runDraftPath,
  specVersionPath,
  writeDataJson,
  writeDataText,
} from '#core/data-files.ts';
import { listEventsSince } from '#core/db/repositories/events.ts';
import { enqueueJob, getJob } from '#core/db/repositories/jobs.ts';
import { createRun } from '#core/db/repositories/runs.ts';
import { createSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { exportSlug, finalRenderBlockers, loadRunRenderInput } from '../render/run-target.ts';
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
  runId = createRun(t.db, { topicId, seriesId }).id;
});

afterEach(() => {
  vi.useRealTimers();
  t.cleanup();
});

function saveSpec(spec: unknown, version = 1): void {
  const jsonPath = writeDataJson(t.dataDir, specVersionPath(runId, version), spec);
  createSpecVersion(t.db, { runId, version, jsonPath, createdBy: 'agent' });
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

async function runJob(type: string, payload: Record<string, unknown> = {}) {
  const fake = fakeTools();
  const registry = createJobRegistry(
    renderJobHandlers({ db: t.db, dataDir: t.dataDir, tools: fake.tools }),
  );
  const job = enqueueJob(t.db, { type, runId, payload });
  await runNextJob({
    db: t.db,
    registry,
    workerId: 'test:1',
    signal: new AbortController().signal,
  });
  const events = listEventsSince(t.db, { jobId: job.id, afterId: 0, limit: 500 });
  return { job: getJob(t.db, job.id)!, events, fake };
}

const logs = (events: { type: string; payload: unknown }[]) =>
  events.filter((e) => e.type === 'log').map((e) => (e.payload as { message: string }).message);

describe('render jobs', () => {
  it('render_draft renders every beat, joins them and records missing assets', async () => {
    saveSpec(rateLimiterSpec);
    const { job, events } = await runJob(RENDER_JOB_TYPES.draft);
    expect(job.status).toBe('done');
    expect(existsSync(resolveDataPath(t.dataDir, runDraftPath(runId)))).toBe(true);
    expect(logs(events)[0]).toMatch(/rendered hook, bucket-intro, bucket-empty, payoff/);
    expect(events.some((e) => e.type === 'progress')).toBe(true);
    expect(readMissingAssets(t.dataDir, runId)).toEqual([]);
  });

  it('render_draft after a one-beat edit re-renders only that beat', async () => {
    saveSpec(rateLimiterSpec);
    await runJob(RENDER_JOB_TYPES.draft);
    // A user edit at the scenes gate: the payoff tag's text.
    const scenes = rateLimiterSpec.scenes.map((s) =>
      s.beatId === 'payoff'
        ? { ...s, elements: s.elements.map((e) => ({ ...e, props: { text: 'slowed down' } })) }
        : s,
    );
    saveSpec({ ...rateLimiterSpec, scenes }, 2);
    const { events, fake } = await runJob(RENDER_JOB_TYPES.draft);
    expect(fake.engine.videos.map((v) => v.inputProps.beatId)).toEqual(['payoff']);
    expect(logs(events)[0]).toMatch(/^Spec v2: rendered payoff; reused 3 cached clip\(s\)\./);
  });

  it('render_beat_draft renders one beat', async () => {
    saveSpec(rateLimiterSpec);
    const { job, fake } = await runJob(RENDER_JOB_TYPES.beatDraft, { beatId: 'bucket-empty' });
    expect(job.status).toBe('done');
    expect(fake.engine.videos.map((v) => v.inputProps.beatId)).toEqual(['bucket-empty']);
  });

  it('render_final refuses a spec without narration timing', async () => {
    saveSpec(rateLimiterSpec);
    const { job, fake } = await runJob(RENDER_JOB_TYPES.final);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Final render refused:\n {2}The spec has no narration timing/);
    expect(fake.engine.videos).toEqual([]);
  });

  it('render_final writes exports/<id>/<slug>.mp4 for a timed spec', async () => {
    saveSpec(timedSpec());
    const { job, fake } = await runJob(RENDER_JOB_TYPES.final);
    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    const out = exportVideoPath(runId, 'how-a-rate-limiter-works');
    expect(existsSync(resolveDataPath(t.dataDir, out))).toBe(true);
    expect(fake.engine.videos[0]?.preset).toEqual({ width: 1080, height: 1920, fps: 30 });
  });

  it('render_stills writes one PNG per beat and does not fail the run on error', async () => {
    saveSpec(rateLimiterSpec);
    const { job } = await runJob(RENDER_JOB_TYPES.stills);
    expect(job.status).toBe('done');
    expect(existsSync(resolveDataPath(t.dataDir, beatStillPath(runId, 'payoff')))).toBe(true);
    const handler = renderJobHandlers({ db: t.db, dataDir: t.dataDir, tools: fakeTools().tools });
    expect(handler.find((h) => h.type === RENDER_JOB_TYPES.stills)?.failsRun).toBe(false);
  });

  it('fails clearly when the run has no spec', async () => {
    const { job } = await runJob(RENDER_JOB_TYPES.draft);
    expect(job.error).toBe(`Run ${runId} has no spec yet; nothing to render.`);
  });
});

describe('loadRunRenderInput', () => {
  it('resolves series, handle, assets and narration for the newest spec version', () => {
    saveSpec(timedSpec());
    const input = loadRunRenderInput(t.db, t.dataDir, runId);
    expect(input.specVersion).toBe(1);
    expect(input.target.props.series).toEqual({ label: 'SYSTEM DESIGN', accentColour: '#4F8CFF' });
    expect(input.target.audioPath).toBe(resolveDataPath(t.dataDir, `runs/${runId}/narration.wav`));
    expect(finalRenderBlockers(input)).toEqual([]);
  });

  it('refuses a timed spec whose narration file is missing', () => {
    const spec = timedSpec();
    saveSpec({ ...spec, timing: { ...spec.timing, audioFile: `runs/${runId}/gone.wav` } });
    expect(() => loadRunRenderInput(t.db, t.dataDir, runId)).toThrow(
      `Narration file runs/${runId}/gone.wav is missing`,
    );
  });

  it('throws every structured error for an unrenderable spec', () => {
    saveSpec({ ...rateLimiterSpec, scenes: undefined });
    expect(() => loadRunRenderInput(t.db, t.dataDir, runId)).toThrow(
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
    saveSpec({ ...timedSpec(), scenes });
    const blockers = finalRenderBlockers(loadRunRenderInput(t.db, t.dataDir, runId));
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
