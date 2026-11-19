import { AssetGlyph } from '../../assets/AssetGlyph.tsx';
import {
  emphasisShadow,
  emphasisStroke,
  EMPHASIS_THRESHOLD,
  markHostCss,
  markLevels,
} from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../../theme/index.ts';
import { Badge, SMALL_BADGE } from '../badge.tsx';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import { shakeOffset } from '../motion.ts';
import { buttonFaces, type ButtonFace } from './button.ts';
import { deviceBezel, type DeviceButton, type DeviceFrameProps } from './definition.ts';

type Row = NonNullable<DeviceFrameProps['rows']>[number];

/** A generic phone or tablet: an outline, a screen with a status line, rows and a button. */
export function DeviceFrame({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<DeviceFrameProps>) {
  const tint = semanticTint(theme, 'neutral');
  const bezel = deviceBezel(theme);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...stateStyle(state),
        position: 'relative',
        boxSizing: 'border-box',
        width: box.width,
        height: box.height,
        padding: bezel,
        borderRadius: theme.radius.lg * 2,
        border: `${emphasisStroke(theme, theme.stroke.bold, state)}px solid ${theme.colours.ink.primary}`,
        background: theme.colours.surface,
        boxShadow: emphasisShadow(theme, tint, state.emphasis),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.lg * 2} size={box} />
      <Screen theme={theme} props={props} state={state} />
    </div>
  );
}

type ScreenProps = Pick<PrimitiveComponentProps<DeviceFrameProps>, 'theme' | 'props' | 'state'>;

function Screen({ theme, props, state }: ScreenProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        height: '100%',
        borderRadius: theme.radius.lg,
        border: `${theme.stroke.hairline}px solid ${theme.colours.line}`,
        background: theme.colours.background,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.space.sm,
        padding: theme.space.md,
      }}
    >
      <Notch theme={theme} />
      {props.status ? (
        <div style={{ ...textCss(theme, 'label'), color: theme.colours.ink.muted }}>
          {props.status}
        </div>
      ) : null}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: theme.space.sm }}>
        {(props.rows ?? []).map((row) => (
          <DeviceRow key={row.id} theme={theme} row={row} part={partState(state, row.id)} />
        ))}
      </div>
      {props.button ? (
        <Button theme={theme} button={props.button} morph={state.actions.morph} />
      ) : null}
    </div>
  );
}

function Notch({ theme }: { theme: Theme }) {
  return (
    <div
      style={{
        alignSelf: 'center',
        width: 96,
        height: theme.space.xs,
        borderRadius: theme.radius.pill,
        background: theme.colours.ink.faint,
      }}
    />
  );
}

type RowProps = { theme: Theme; row: Row; part: PartState };

/** A list row: fades in on `enter`, swipes on highlight, turns red with ✗ on `reject`. */
function DeviceRow({ theme, row, part }: RowProps) {
  const rejected = part.actions.reject ?? 0;
  const tint = semanticTint(theme, rejected > 0 ? 'problem' : 'neutral');
  const emphasised = part.emphasis > EMPHASIS_THRESHOLD;
  const accent = rejected > 0 ? tint.base : emphasised ? semanticTint(theme, 'focus').base : null;
  const base = stateStyle(part);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...base,
        transform: `${base.transform} translateX(${shakeOffset(rejected, theme.space.xs)}px)`,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: theme.space.sm,
        padding: `${theme.space.sm}px ${theme.space.sm}px`,
        borderRadius: theme.radius.sm,
        border: `${emphasisStroke(theme, theme.stroke.thin, part)}px solid ${accent ?? theme.colours.line}`,
        background: theme.colours.surface,
        boxShadow: emphasisShadow(theme, tint, part.emphasis),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(part)} radius={theme.radius.sm} />
      {row.icon ? (
        <AssetGlyph
          theme={theme}
          assetId={row.icon}
          size={theme.text.label.size * 1.3}
          colour={accent ?? theme.colours.ink.muted}
        />
      ) : null}
      <div
        style={{ ...textCss(theme, 'label'), flex: 1, color: accent ?? theme.colours.ink.primary }}
      >
        {row.label}
      </div>
      {row.detail ? (
        <div style={{ ...textCss(theme, 'data'), color: theme.colours.ink.muted }}>
          {row.detail}
        </div>
      ) : null}
      {rejected > 0 ? (
        <Badge theme={theme} colour={tint.base} opacity={rejected} size={SMALL_BADGE}>
          ✗
        </Badge>
      ) : null}
    </div>
  );
}

type ButtonProps = { theme: Theme; button: DeviceButton; morph: number | undefined };

/** The button; on `morph` its face cross-fades into the `then` label and colour. */
function Button({ theme, button, morph }: ButtonProps) {
  const height = theme.text.tag.size + 2 * theme.space.md;
  return (
    <div style={{ position: 'relative', height }}>
      {buttonFaces(button, morph).map((face) => (
        <ButtonFaceView key={face.label} theme={theme} face={face} />
      ))}
    </div>
  );
}

function ButtonFaceView({ theme, face }: { theme: Theme; face: ButtonFace }) {
  return (
    <div
      style={{
        ...textCss(theme, 'tag'),
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        background: semanticTint(theme, face.semantic).base,
        color: theme.colours.background,
        opacity: face.opacity,
      }}
    >
      {face.label}
    </div>
  );
}
