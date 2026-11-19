import type { AssetShape, LibraryAsset, LogoFile } from '@explainer-studio/shared';
import { Img } from 'remotion';
import { textCss, type Theme } from '../theme/index.ts';
import { useAssetContext } from './AssetContext.tsx';
import { HOUSE_VIEWBOX } from './house-svg.ts';
import { resolveGlyph } from './library.ts';

type Props = {
  theme: Theme;
  assetId: string;
  /** Square side in px. */
  size: number;
  /** Stroke colour (`currentColor` in the asset). */
  colour: string;
  /** Soft fill for `var(--asset-fill)` shapes; omitted draws them unfilled. */
  fill?: string | undefined;
  /** CSS `filter` for the glow, or undefined. */
  filter?: string | undefined;
};

/**
 * An asset id drawn at `size`: library shapes in the house stroke style, a user's logo file
 * (its own colours, never restyled), or a neutral placeholder showing a readable label.
 */
export function AssetGlyph(props: Props) {
  const source = resolveGlyph(props.assetId, useAssetContext());
  if (source.kind === 'library') return <LibraryGlyph {...props} asset={source.asset} />;
  if (source.kind === 'logo')
    return <LogoGlyph {...props} file={source.file} label={source.label} />;
  return (
    <AssetPlaceholder
      theme={props.theme}
      assetId={props.assetId}
      size={props.size}
      label={source.label}
    />
  );
}

/** House strokes are 2 units in the 24-unit box; theme strokes are px at the drawn size. */
export function houseStrokeWidth(theme: Theme, size: number): number {
  const width = (theme.stroke.regular * HOUSE_VIEWBOX) / size;
  return Math.max(1.5, Math.min(2.5, width));
}

function LibraryGlyph({
  theme,
  size,
  colour,
  fill,
  filter,
  asset,
}: Props & { asset: LibraryAsset }) {
  return (
    <svg
      data-asset={asset.id}
      width={size}
      height={size}
      viewBox={`0 0 ${HOUSE_VIEWBOX} ${HOUSE_VIEWBOX}`}
      fill="none"
      stroke={colour}
      strokeWidth={houseStrokeWidth(theme, size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ filter, overflow: 'visible', flexShrink: 0, color: colour }}
    >
      {asset.shapes.map((shape, i) => (
        <ShapeView key={i} shape={shape} fill={fill} />
      ))}
    </svg>
  );
}

/** One shape; the soft-fill token resolves to a real colour (CSS vars are not used in SVG attrs). */
function ShapeView({ shape, fill }: { shape: AssetShape; fill: string | undefined }) {
  const { fill: fillToken, ...attrs } = shape.attrs;
  const resolvedFill = fillToken === 'var(--asset-fill)' ? (fill ?? 'none') : fillToken;
  const Tag = shape.tag;
  return <Tag {...attrs} fill={resolvedFill} />;
}

/** A user-supplied logo, contained in the square; it keeps its own colours. */
function LogoGlyph({ size, filter, file, label }: Props & { file: LogoFile; label: string }) {
  return (
    <Img
      data-logo={file.id}
      src={file.dataUri}
      alt={label}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, filter }}
    />
  );
}

/** Neutral, not an error marker: a missing asset is a backlog item, not a broken spec. */
function AssetPlaceholder({
  theme,
  assetId,
  size,
  label,
}: Pick<Props, 'theme' | 'assetId' | 'size'> & { label: string }) {
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
        overflowWrap: 'anywhere',
        lineHeight: 1.1,
        padding: theme.space.xs / 2,
        fontSize: Math.min(theme.text.footnote.size, size / 4),
        color: theme.colours.ink.muted,
        border: `${theme.stroke.thin}px dashed ${theme.colours.ink.faint}`,
        borderRadius: theme.radius.md,
      }}
    >
      {label}
    </div>
  );
}
