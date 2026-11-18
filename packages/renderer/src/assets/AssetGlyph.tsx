import { textCss, type Theme } from '../theme/index.ts';
import { getAsset } from './builtin.ts';

type Props = {
  theme: Theme;
  assetId: string;
  /** Square side in px. */
  size: number;
  colour: string;
  /** CSS `filter` for the glow, or undefined. */
  filter?: string | undefined;
};

/** Lucide strokes are 2 units in a 24-unit box; theme strokes are in px at the drawn size. */
const VIEWBOX = 24;

/** A built-in asset drawn as stroked SVG, or a neutral dashed placeholder for unknown ids. */
export function AssetGlyph({ theme, assetId, size, colour, filter }: Props) {
  const asset = getAsset(assetId);
  if (!asset) return <AssetPlaceholder theme={theme} assetId={assetId} size={size} />;
  const strokeWidth = (theme.stroke.regular * VIEWBOX) / size;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      fill="none"
      stroke={colour}
      strokeWidth={Math.max(1.5, Math.min(2.5, strokeWidth))}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ filter, overflow: 'visible', flexShrink: 0 }}
    >
      {asset.glyph.map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} />
      ))}
    </svg>
  );
}

/** Neutral, not an error marker: a missing asset is a backlog item, not a broken spec. */
function AssetPlaceholder({ theme, assetId, size }: Omit<Props, 'colour'>) {
  return (
    <div
      data-asset-placeholder={assetId}
      style={{
        ...textCss(theme, 'footnote'),
        width: size,
        height: size,
        flexShrink: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        overflow: 'hidden',
        wordBreak: 'break-all',
        padding: theme.space.xs / 2,
        fontSize: Math.min(theme.text.footnote.size, size / 4),
        color: theme.colours.ink.muted,
        border: `${theme.stroke.thin}px dashed ${theme.colours.ink.faint}`,
        borderRadius: theme.radius.md,
      }}
    >
      {assetId}
    </div>
  );
}
