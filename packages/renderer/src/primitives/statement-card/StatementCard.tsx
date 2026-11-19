import { emphasisShadow, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark, FocusUnderline } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import { riseView } from '../overlay.ts';
import { cardSurfaceCss } from '../surface.ts';
import { STATEMENT_STYLE, statementPadding, type StatementCardProps } from './definition.ts';

type Line = StatementCardProps['lines'][number];

/** Large lines over the dimmed scene; `enter` fades and rises, lines enter on their own words. */
export function StatementCard({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<StatementCardProps>) {
  const rise = riseView(state, theme.space.lg);
  const pad = statementPadding(theme);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...cardSurfaceCss(theme, semanticTint(theme, 'neutral'), state, { wash: false }),
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: rise.opacity,
        transform: rise.transform,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: theme.space.md,
        padding: `${pad.y - theme.stroke.regular}px ${pad.x - theme.stroke.regular}px`,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} size={box} />
      {props.lines.map((line) => (
        <StatementLine key={line.id} theme={theme} line={line} part={partState(state, line.id)} />
      ))}
    </div>
  );
}

type LineProps = { theme: Theme; line: Line; part: PartState };

function StatementLine({ theme, line, part }: LineProps) {
  const tint = semanticTint(theme, line.semantic);
  const colour = line.semantic === 'neutral' ? theme.colours.ink.primary : tint.base;
  const rise = riseView(part, theme.space.md);
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...textCss(theme, STATEMENT_STYLE),
        position: 'relative',
        overflowWrap: 'break-word',
        color: colour,
        opacity: rise.opacity,
        transform: rise.transform,
        textShadow: emphasisShadow(theme, tint, part.emphasis),
      }}
    >
      <BoxMark theme={theme} levels={markLevels(part)} />
      <FocusUnderline theme={theme} semantic={line.semantic} highlight={part.highlight} wrap>
        {line.text}
      </FocusUnderline>
    </div>
  );
}
