import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import { emphasisFilter, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import type { IconProps } from './definition.ts';

/** A bare asset glyph in its semantic colour; emphasis comes from the theme (`emphasis.ts`). */
export function Icon({ theme, props, box, state }: PrimitiveComponentProps<IconProps>) {
  const tint = semanticTint(theme, props.semantic);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...stateStyle(state),
        width: box.width,
        height: box.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} />
      <AssetGlyph
        theme={theme}
        assetId={props.asset}
        size={Math.min(box.width, box.height)}
        colour={tint.base}
        filter={emphasisFilter(theme, tint, state.emphasis)}
      />
    </div>
  );
}
