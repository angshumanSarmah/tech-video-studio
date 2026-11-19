import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import { emphasisFilter, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss } from '../../theme/index.ts';
import { Badge, BADGE_GLYPH } from '../badge.tsx';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { shakeOffset } from '../motion.ts';
import { cardSurfaceCss } from '../surface.ts';
import { nodeCardIconSize, type NodeCardProps } from './definition.ts';

/** Component card. `lock` shows a padlock badge; `reject` turns it red, shakes and shows ✗. */
export function NodeCard({ theme, props, box, state }: PrimitiveComponentProps<NodeCardProps>) {
  const rejected = state.actions.reject ?? 0;
  const locked = state.actions.lock ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : props.semantic);
  const base = stateStyle(state);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...base,
        ...cardSurfaceCss(theme, tint, state),
        transform: `${base.transform} translateX(${shakeOffset(rejected, theme.space.sm)}px)`,
        position: 'relative',
        width: box.width,
        height: box.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.md,
        padding: `0 ${theme.space.lg}px`,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} size={box} />
      {props.icon ? (
        <AssetGlyph
          theme={theme}
          assetId={props.icon}
          size={nodeCardIconSize(theme)}
          colour={tint.base}
          filter={emphasisFilter(theme, tint, state.emphasis)}
        />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.xs, minWidth: 0 }}>
        <div style={{ ...textCss(theme, 'title'), color: theme.colours.ink.primary }}>
          {props.title}
        </div>
        {props.subtitle ? (
          <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
            {props.subtitle}
          </div>
        ) : null}
      </div>
      {locked > 0 ? (
        <Badge theme={theme} colour={semanticTint(theme, 'focus').base} opacity={locked}>
          <AssetGlyph
            theme={theme}
            assetId="lock"
            size={BADGE_GLYPH}
            colour={theme.colours.background}
          />
        </Badge>
      ) : null}
      {rejected > 0 ? (
        <Badge theme={theme} colour={tint.base} opacity={rejected} left>
          ✗
        </Badge>
      ) : null}
    </div>
  );
}
