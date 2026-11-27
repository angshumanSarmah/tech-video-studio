import { DEFAULT_THEME_ID } from '@explainer-studio/renderer/theme';
import type { LibraryAsset } from '@explainer-studio/shared';
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getRendererBundle } from './bundle.ts';

export interface AssetSheetRequest {
  readonly assets: readonly LibraryAsset[];
  readonly title: string;
  /** Absolute PNG path. */
  readonly outPath: string;
  readonly themeId?: string;
}

/**
 * Renders the renderer's `AssetSheet` still (P1C.12): a contact sheet of library assets, for
 * reviewing an import (`assets:sheet`) and, later, draft variants. Uses the shared bundle.
 */
export async function renderAssetSheet(request: AssetSheetRequest): Promise<void> {
  const { serveUrl } = await getRendererBundle();
  await ensureBrowser();
  const inputProps = {
    themeId: request.themeId ?? DEFAULT_THEME_ID,
    title: request.title,
    assets: [...request.assets],
  };
  const composition = await selectComposition({
    serveUrl,
    id: 'AssetSheet',
    inputProps,
    logLevel: 'error',
  });
  mkdirSync(dirname(request.outPath), { recursive: true });
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    output: request.outPath,
    overwrite: true,
    imageFormat: 'png',
    logLevel: 'error',
  });
}
