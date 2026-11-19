import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import { emphasisFilter, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { Badge } from '../badge.tsx';
import { shakeOffset } from '../motion.ts';
import { cardSurfaceCss } from '../surface.ts';
import { ITEM_GLYPH_SCALE, itemTileSize, type ItemIconProps } from './definition.ts';

/** Everyday object on a soft tile with a caption; `reject` turns it red, shakes and shows ✗. */
export function ItemIcon({ theme, props, box, state }: PrimitiveComponentProps<ItemIconProps>) {
  const rejected = state.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  const tile = itemTileSize(theme);
  const base = stateStyle(state);
  return (
    <div
      style={{
        ...base,
        transform: `${base.transform} translateX(${shakeOffset(rejected, theme.space.sm)}px)`,
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.sm,
      }}
    >
      <div
        style={{
          ...markHostCss(theme),
          ...cardSurfaceCss(theme, tint, state),
          position: 'relative',
          width: tile,
          height: tile,
          borderRadius: theme.radius.lg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.lg} />
        <AssetGlyph
          theme={theme}
          assetId={props.asset}
          size={Math.round(tile * ITEM_GLYPH_SCALE)}
          colour={tint.base}
          filter={emphasisFilter(theme, tint, state.emphasis)}
        />
        {rejected > 0 ? (
          <Badge theme={theme} colour={tint.base} opacity={rejected}>
            ✗
          </Badge>
        ) : null}
      </div>
      <div
        style={{
          ...textCss(theme, 'label'),
          color: theme.colours.ink.primary,
          whiteSpace: 'nowrap',
        }}
      >
        {props.caption}
      </div>
    </div>
  );
}
