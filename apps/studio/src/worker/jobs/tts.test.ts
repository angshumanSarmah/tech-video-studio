import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rateLimiterSpec } from '@explainer-studio/renderer/fixtures';
import {
  SettingsSchema,
  validateRenderableVideoSpec,
  type RunSettingsInput,
} from '@explainer-studio/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataJson, resolveDataPath, specVersionPath, writeDataJson } from '#core/data-files.ts';
import { enqueueJob, getJob } from '#core/db/repositories/jobs.ts';
import { createRun } from '#core/db/repositories/runs.ts';
import { createSpecVersion, getLatestSpecVersion } from '#core/db/repositories/spec-versions.ts';
import { createTopic } from '#core/db/repositories/topics.ts';
import { series } from '#core/db/schema.ts';
import { createTestDb, type TestDb } from '#core/db/testing.ts';
import { parseWav } from '../render/audio.ts';
import { runNextJob } from '../runner.ts';
import { fakeNarratedBeat } from '../timing/testing.ts';
import type { SynthesizeOptions, TtsProvider } from '../tts/provider.ts';
import { createJobRegistry } from './registry.ts';
import { TTS_JOB_TYPE, ttsJobHandler } from './tts.ts';

let t: TestDb;
const wavDir = mkdtempSync(join(tmpdir(), 'tts-job-'));

beforeEach(() => {
  t = createTestDb();
  vi.useFakeTimers({ now: Date.now() + 60_000 });
});

afterEach(() => {
  vi.useRealTimers();
  t.cleanup();
});

/** Synthesises like `fakeNarratedBeat`; records each call's voice, speed and signal. */
function fakeProvider() {
  const calls: { text: string; voice: string; speed: number; signal?: AbortSignal }[] = [];
  const provider: TtsProvider = {
    synthesize(text, voice, speed, options: SynthesizeOptions = {}) {
      calls.push({ text, voice, speed, signal: options.signal });
      const beat = fakeNarratedBeat({ beatId: `b${calls.length}`, narration: text });
      const wavPath = join(wavDir, `${calls.length}-${Math.random()}.wav`);
      writeFileSync(wavPath, beat.wav);
      return Promise.resolve({
        wavPath,
        words: [...beat.words],
        durationSec: beat.durationSec,
        cached: false,
      });
    },
    close: () => Promise.resolve(),
  };
  return { provider, calls };
}

function runWith(settings?: RunSettingsInput) {
  const topicId = createTopic(t.db, { title: 'Rate limiters' }).id;
  const seriesId = t.db.select().from(series).where(eq(series.tag, 'system-design')).get()!.id;
  const runId = createRun(t.db, { topicId, seriesId, settings }).id;
  const jsonPath = writeDataJson(t.dataDir, specVersionPath(runId, 1), rateLimiterSpec);
  const version = createSpecVersion(t.db, { runId, version: 1, jsonPath, createdBy: 'agent' });
  return { runId, specVersionId: version.id };
}

async function narrate(runId: number, specVersionId: number, provider: TtsProvider) {
  const app = SettingsSchema.parse({ tts: { voice: 'bf_emma' }, timing: { beatGapSec: 0.25 } });
  const registry = createJobRegistry([
    ttsJobHandler({
      db: t.db,
      dataDir: t.dataDir,
      tts: provider,
      settings: { tts: app.tts, timing: app.timing },
    }),
  ]);
  const job = enqueueJob(t.db, { type: TTS_JOB_TYPE, runId, payload: { specVersionId } });
  const controller = new AbortController();
  await runNextJob({ db: t.db, registry, workerId: 'test:1', signal: controller.signal });
  return getJob(t.db, job.id)!;
}

function latestSpec(runId: number) {
  const latest = getLatestSpecVersion(t.db, runId)!;
  const result = validateRenderableVideoSpec(readDataJson(t.dataDir, latest.jsonPath));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return { version: latest.version, spec: result.spec };
}

describe('tts job', () => {
  it('narrates every beat and saves the spec re-timed, with a matching narration track', async () => {
    const { runId, specVersionId } = runWith({ tts: { speed: 1.1 } });
    const { provider, calls } = fakeProvider();
    const job = await narrate(runId, specVersionId, provider);
    expect(job.status).toBe('done');
    expect(calls.map((c) => c.text)).toEqual(rateLimiterSpec.script.map((s) => s.narration));
    expect(calls.every((c) => c.voice === 'bf_emma' && c.speed === 1.1)).toBe(true);
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);

    const { version, spec } = latestSpec(runId);
    const timing = spec.timing!;
    expect(version).toBe(2);
    expect(timing.pauses).toEqual({ beatGapSec: 0.25, landingSec: 0, endTailSec: 0.5 });
    expect(timing.beats[1]!.startSec).toBeCloseTo(timing.beats[0]!.endSec + 0.25, 4);
    const track = parseWav(readFileSync(resolveDataPath(t.dataDir, timing.audioFile)));
    const trackSec = ((track?.dataEnd ?? 0) - (track?.dataStart ?? 0)) / 2 / 1000;
    expect(trackSec).toBeCloseTo(timing.endSec!, 2);
  });

  it('applies a run’s landing override after each beat’s settled point', async () => {
    const { runId, specVersionId } = runWith({ timing: { landingSec: 1, beatGapSec: 0 } });
    await narrate(runId, specVersionId, fakeProvider().provider);
    const timing = latestSpec(runId).spec.timing!;
    expect(timing.pauses).toEqual({ beatGapSec: 0, landingSec: 1, endTailSec: 0.5 });
    const holds = timing.beats.slice(1).map((b, i) => b.startSec - timing.beats[i]!.endSec);
    expect(Math.max(...holds)).toBeGreaterThan(0.5);
  });

  it('saves nothing new when it runs again (at-least-once delivery)', async () => {
    const { runId, specVersionId } = runWith();
    await narrate(runId, specVersionId, fakeProvider().provider);
    const again = await narrate(runId, specVersionId, fakeProvider().provider);
    expect(again.status).toBe('done');
    expect(latestSpec(runId).version).toBe(2);
  });

  it('passes the shutdown abort to the provider, so the job is requeued', async () => {
    const { runId, specVersionId } = runWith();
    const app = SettingsSchema.parse({});
    const hanging: TtsProvider = {
      synthesize: (_text, _voice, _speed, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted', { cause: options.signal?.reason })),
          ),
        ),
      close: () => Promise.resolve(),
    };
    const registry = createJobRegistry([
      ttsJobHandler({ db: t.db, dataDir: t.dataDir, tts: hanging, settings: app }),
    ]);
    const job = enqueueJob(t.db, { type: TTS_JOB_TYPE, runId, payload: { specVersionId } });
    const controller = new AbortController();
    const running = runNextJob({
      db: t.db,
      registry,
      workerId: 'test:1',
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(getJob(t.db, job.id)?.status).toBe('running'));
    controller.abort(new Error('worker shutting down'));
    await running;
    expect(getJob(t.db, job.id)?.status).toBe('queued');
  });

  it('fails the job when synthesis fails', async () => {
    const { runId, specVersionId } = runWith();
    const failing: TtsProvider = {
      synthesize: () => Promise.reject(new Error('word not spoken: zorblax')),
      close: () => Promise.resolve(),
    };
    const job = await narrate(runId, specVersionId, failing);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/word not spoken: zorblax/);
    expect(latestSpec(runId).version).toBe(1);
  });
});
