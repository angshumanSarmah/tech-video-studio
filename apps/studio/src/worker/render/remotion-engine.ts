import {
  ensureBrowser,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
  type HeadlessBrowser,
} from '@remotion/renderer';
import { getRendererBundle } from './bundle.ts';
import { encodingFor, presetScale } from './encoding.ts';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  RenderEngine,
  RenderSession,
  SheetRequest,
  StillRequest,
  VideoRequest,
} from './engine.ts';

/**
 * `RenderEngine` over `@remotion/renderer`: the shared bundle (`bundle.ts`) and one headless
 * browser per session, reused by every composition and still in it. Videos are rendered muted.
 */
export function createRemotionEngine(): RenderEngine {
  return {
    identity: async () => (await getRendererBundle()).sourceHash,
    open: openSession,
  };
}

async function openSession(): Promise<RenderSession> {
  const { serveUrl } = await getRendererBundle();
  await ensureBrowser();
  const browser = await openBrowser('chrome', { logLevel: 'error' });
  return {
    renderVideo: (request) => renderVideo(serveUrl, browser, request),
    renderStill: (request) => renderStillFrame(serveUrl, browser, request),
    renderSheet: (request) => renderSheetStill(serveUrl, browser, request),
    close: () => browser.close({ silent: true }),
  };
}

async function renderVideo(
  serveUrl: string,
  browser: HeadlessBrowser,
  request: VideoRequest,
): Promise<{ frames: number }> {
  const composition = await select(serveUrl, browser, request);
  const encoding = encodingFor(request.mode);
  await withCancel(request.signal, (cancelSignal) =>
    renderMedia({
      serveUrl,
      composition,
      inputProps: request.inputProps,
      puppeteerInstance: browser,
      outputLocation: request.outPath,
      overwrite: true,
      muted: true,
      codec: encoding.codec,
      pixelFormat: encoding.pixelFormat,
      crf: encoding.crf,
      x264Preset: encoding.x264Preset,
      scale: presetScale(request.preset, composition),
      concurrency: request.concurrency,
      cancelSignal,
      logLevel: 'error',
      onProgress: ({ progress }) => request.onProgress(progress),
    }),
  );
  return { frames: composition.durationInFrames };
}

async function renderStillFrame(
  serveUrl: string,
  browser: HeadlessBrowser,
  request: StillRequest,
): Promise<void> {
  const composition = await select(serveUrl, browser, request);
  await withCancel(request.signal, (cancelSignal) =>
    renderStill({
      serveUrl,
      composition,
      inputProps: request.inputProps,
      puppeteerInstance: browser,
      output: request.outPath,
      overwrite: true,
      frame: request.frame,
      imageFormat: 'png',
      scale: presetScale(request.preset, composition),
      cancelSignal,
      logLevel: 'error',
    }),
  );
}

async function renderSheetStill(
  serveUrl: string,
  browser: HeadlessBrowser,
  request: SheetRequest,
): Promise<void> {
  request.signal.throwIfAborted();
  const composition = await selectComposition({
    serveUrl,
    id: request.compositionId,
    inputProps: request.inputProps,
    puppeteerInstance: browser,
    logLevel: 'error',
  });
  mkdirSync(dirname(request.outPath), { recursive: true });
  await withCancel(request.signal, (cancelSignal) =>
    renderStill({
      serveUrl,
      composition,
      inputProps: request.inputProps,
      puppeteerInstance: browser,
      output: request.outPath,
      overwrite: true,
      frame: 0,
      imageFormat: 'png',
      cancelSignal,
      logLevel: 'error',
    }),
  );
}

/** Runs `calculateMetadata` (which validates the spec) and checks the fps matches the preset. */
async function select(
  serveUrl: string,
  browser: HeadlessBrowser,
  request: Pick<VideoRequest, 'compositionId' | 'inputProps' | 'preset' | 'signal'>,
) {
  request.signal.throwIfAborted();
  const composition = await selectComposition({
    serveUrl,
    id: request.compositionId,
    inputProps: request.inputProps,
    puppeteerInstance: browser,
    logLevel: 'error',
  });
  if (composition.fps !== request.preset.fps) {
    throw new Error(
      `Composition fps ${composition.fps} does not match the preset's ${request.preset.fps}.`,
    );
  }
  return composition;
}

/** Bridges an `AbortSignal` to Remotion's cancel signal for one call. */
async function withCancel<T>(
  signal: AbortSignal,
  fn: (cancelSignal: ReturnType<typeof makeCancelSignal>['cancelSignal']) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const { cancelSignal, cancel } = makeCancelSignal();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await fn(cancelSignal);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
