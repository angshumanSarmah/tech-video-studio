import { describe, expect, it } from 'vitest';
import { END_TAIL_SEC } from '../spec/effective-timing.ts';
import { SettingsSchema } from './settings.ts';

describe('SettingsSchema defaults', () => {
  it('turns an empty object into a complete config', () => {
    const settings = SettingsSchema.parse({});
    expect(settings.tts).toEqual({
      binaryPath: 'apps/studio/tts-python/.venv/bin/python',
      voice: 'af_heart',
      speed: 1,
    });
    expect(settings.render).toEqual({
      concurrency: 3,
      presets: {
        draft: { width: 540, height: 960, fps: 15 },
        final: { width: 1080, height: 1920, fps: 30 },
      },
    });
    expect(settings.llm.models.director).toBe('deepseek-v4-pro');
  });

  it('defaults the timing pauses to none, with the usual end tail', () => {
    expect(SettingsSchema.parse({}).timing).toEqual({
      beatGapSec: 0,
      landingSec: 0,
      endTailSec: END_TAIL_SEC,
    });
  });

  it.each([-0.1, 3.5])('rejects a pause of %s s', (beatGapSec) => {
    expect(SettingsSchema.safeParse({ timing: { beatGapSec } }).success).toBe(false);
  });

  it('fills defaults around a partial override', () => {
    const settings = SettingsSchema.parse({
      render: { presets: { draft: { width: 720, height: 1280, fps: 24 } } },
    });
    expect(settings.render.presets.draft.width).toBe(720);
    expect(settings.render.presets.final.fps).toBe(30);
    expect(settings.render.concurrency).toBe(3);
  });

  it('is idempotent: parsing its own output yields the same value', () => {
    const once = SettingsSchema.parse({});
    expect(SettingsSchema.parse(once)).toEqual(once);
  });
});

describe('SettingsSchema validation', () => {
  const paths = (input: unknown): string[] => {
    const result = SettingsSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
  };

  it('rejects unknown keys at any level so typos fail loudly', () => {
    expect(paths({ rendr: {} })).toEqual(['']);
    expect(paths({ tts: { voise: 'x' } })).toEqual(['tts']);
  });

  it('rejects odd preset dimensions and out-of-range fps', () => {
    expect(
      paths({ render: { presets: { final: { width: 1081, height: 1920, fps: 0 } } } }),
    ).toEqual(['render.presets.final.width', 'render.presets.final.fps']);
  });

  it('rejects non-integer or zero render concurrency', () => {
    expect(paths({ render: { concurrency: 0 } })).toEqual(['render.concurrency']);
    expect(paths({ render: { concurrency: 1.5 } })).toEqual(['render.concurrency']);
  });

  it('rejects an empty voice and out-of-range speed', () => {
    expect(paths({ tts: { voice: ' ', speed: 3 } })).toEqual(['tts.voice', 'tts.speed']);
  });
});

describe('SettingsSchema video', () => {
  it('defaults length, parts and pace to the prompt defaults', () => {
    expect(SettingsSchema.parse({}).video).toEqual({
      lengthMinSec: 45,
      lengthMaxSec: 150,
      lengthReasonAboveSec: 90,
      allowParts: true,
      maxParts: 4,
      wordsPerSec: 2.7,
    });
  });

  it.each([
    [{ lengthMaxSec: 171 }, 'video.lengthMaxSec'],
    [{ lengthMinSec: 14 }, 'video.lengthMinSec'],
    [{ lengthMinSec: 100 }, 'video.lengthReasonAboveSec'],
    [{ lengthMaxSec: 80 }, 'video.lengthMaxSec'],
  ])('rejects %j', (video, path) => {
    const result = SettingsSchema.safeParse({ video });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(path);
  });
});
