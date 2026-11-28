import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsSchema, type RenderSettings } from '@explainer-studio/shared';
import type { RenderEngine, SheetRequest, StillRequest, VideoRequest } from './engine.ts';
import type { RenderTools } from './target.ts';

/** Test-only helpers for the render service. Not imported by any entrypoint. */

export const TEST_RENDER_SETTINGS: RenderSettings = SettingsSchema.parse({}).render;

/** A fake engine that writes placeholder files and records every request. */
export function fakeEngine(identity = 'engine-v1') {
  const videos: VideoRequest[] = [];
  const stills: StillRequest[] = [];
  const sheets: SheetRequest[] = [];
  let sessions = 0;
  const engine: RenderEngine = {
    identity: () => Promise.resolve(identity),
    open: () => {
      sessions += 1;
      return Promise.resolve({
        renderVideo: (request) => {
          videos.push(request);
          request.signal.throwIfAborted();
          request.onProgress(0.5);
          writeFileSync(request.outPath, `video ${request.compositionId}`);
          request.onProgress(1);
          return Promise.resolve({ frames: 1 });
        },
        renderStill: (request) => {
          stills.push(request);
          writeFileSync(request.outPath, 'png');
          return Promise.resolve();
        },
        renderSheet: (request) => {
          sheets.push(request);
          mkdirSync(dirname(request.outPath), { recursive: true });
          writeFileSync(request.outPath, 'png');
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      });
    },
  };
  return { engine, videos, stills, sheets, sessions: () => sessions };
}

/** A fake ffmpeg that writes its output (the last argument) and records every call. */
export function fakeFfmpeg() {
  const calls: string[][] = [];
  const ffmpeg = (args: readonly string[]) => {
    calls.push([...args]);
    const out = args.at(-1);
    if (out) writeFileSync(out, 'mp4');
    return Promise.resolve('');
  };
  return { ffmpeg, calls };
}

export function fakeTools(identity?: string) {
  const engine = fakeEngine(identity);
  const ff = fakeFfmpeg();
  const tools: RenderTools = {
    engine: engine.engine,
    ffmpeg: ff.ffmpeg,
    settings: TEST_RENDER_SETTINGS,
  };
  return { tools, engine, ff };
}

/** A 16-bit mono PCM WAV of `samples`, with an extra `LIST` chunk before `data`. */
export function makeWav(samples: readonly number[], sampleRate = 1000): Uint8Array {
  const list = 12;
  const data = samples.length * 2;
  const bytes = new Uint8Array(12 + 24 + 8 + list + 8 + data);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true);
  tag(36, 'LIST');
  view.setUint32(40, list, true);
  tag(44 + list, 'data');
  view.setUint32(48 + list, data, true);
  samples.forEach((s, i) => view.setInt16(52 + list + i * 2, s, true));
  return bytes;
}
