import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import { semanticTint } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { GLOW_THRESHOLD } from '../surface.ts';
import type { IconProps } from './definition.ts';

/** A bare asset glyph in its semantic colour; glows while emphasised. */
export function Icon({ theme, props, box, state }: PrimitiveComponentProps<IconProps>) {
  const tint = semanticTint(theme, props.semantic);
  return (
    <div
      style={{
        ...stateStyle(state),
        width: box.width,
        height: box.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AssetGlyph
        theme={theme}
        assetId={props.asset}
        size={Math.min(box.width, box.height)}
        colour={tint.base}
        filter={state.emphasis > GLOW_THRESHOLD ? tint.glowFilter : undefined}
      />
    </div>
  );
}
