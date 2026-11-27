import type { LibraryAsset } from '@explainer-studio/shared';
import { AbsoluteFill } from 'remotion';
import { AssetProvider } from '../assets/AssetContext.tsx';
import { AssetGlyph } from '../assets/AssetGlyph.tsx';
import { assetContext } from '../assets/library.ts';
import { SEED_ASSETS } from '../assets/seed.ts';
import { Background } from '../background/Background.tsx';
import { loadThemeFonts } from '../fonts/load-theme-fonts.ts';
import { DEFAULT_THEME_ID, getTheme, semanticFill, textCss, type Theme } from '../theme/index.ts';
import { ASSET_SHEET_SIZES, assetSheetGrid } from './asset-sheet.ts';

export type AssetSheetProps = {
  themeId: string;
  title: string;
  /** The assets to show, in order (the studio passes rows from its library). */
  assets: LibraryAsset[];
};

export const assetSheetDefaults: AssetSheetProps = {
  themeId: DEFAULT_THEME_ID,
  title: 'Core seed assets',
  assets: SEED_ASSETS.slice(0, 30),
};

/**
 * Contact sheet of library assets (P1C.12): each asset large and at 32 px with its id and
 * family, drawn by `AssetGlyph` from the assets passed in (no seed fallback for unknown ids, so
 * a broken asset shows as a placeholder). Rendered by the studio's `assets:sheet`.
 */
export function AssetSheet({ themeId, title, assets }: AssetSheetProps) {
  const theme = getTheme(themeId);
  loadThemeFonts(theme);
  const pad = theme.space.xl;
  const titleHeight = theme.space.xl * 2;
  const grid = assetSheetGrid(assets.length, {
    width: theme.canvas.width - 2 * pad,
    height: theme.canvas.height - 2 * pad - titleHeight,
  });
  return (
    <AbsoluteFill>
      <Background theme={theme} />
      <AssetProvider value={assetContext(undefined, assets)}>
        <AbsoluteFill style={{ padding: pad, color: theme.colours.ink.primary }}>
          <div style={{ ...textCss(theme, 'title'), height: titleHeight }}>{title}</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${grid.columns}, ${grid.cellWidth}px)`,
              gridAutoRows: `${grid.cellHeight}px`,
            }}
          >
            {assets.map((asset) => (
              <AssetCell key={asset.id} theme={theme} asset={asset} width={grid.cellWidth} />
            ))}
          </div>
        </AbsoluteFill>
      </AssetProvider>
    </AbsoluteFill>
  );
}

function AssetCell({ theme, asset, width }: { theme: Theme; asset: LibraryAsset; width: number }) {
  const [large, small] = ASSET_SHEET_SIZES;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.xs,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: theme.space.sm }}>
        <AssetGlyph
          theme={theme}
          assetId={asset.id}
          size={large}
          colour={theme.colours.ink.primary}
          fill={semanticFill(theme, 'focus', 0.5)}
        />
        <AssetGlyph
          theme={theme}
          assetId={asset.id}
          size={small}
          colour={theme.colours.ink.primary}
        />
      </div>
      <div
        style={{
          ...textCss(theme, 'footnote'),
          maxWidth: width - theme.space.sm,
          textAlign: 'center',
          overflowWrap: 'anywhere',
        }}
      >
        {asset.id}
      </div>
      <div style={{ ...textCss(theme, 'footnote'), color: theme.colours.ink.muted }}>
        {asset.family}
      </div>
    </div>
  );
}
