import { markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import { semanticTint, textCss, type Theme } from '../../theme/index.ts';
import { stateStyle, type PrimitiveComponentProps } from '../component-props.ts';
import { cardSurfaceCss, NO_WRAP } from '../surface.ts';
import { typedFieldChars } from '../typing.ts';
import type { DataBlockProps, DataField } from './definition.ts';
import { dataLines, lineText, visibleParts, type DataLine } from './lines.ts';

/** Key/value block that types in field by field after `enter` (see `typedFieldChars`). */
export function DataBlock({ theme, props, box, state }: PrimitiveComponentProps<DataBlockProps>) {
  const lines = dataLines(props.fields);
  const typed = typedFieldChars(
    lines.map((line) => lineText(line).length),
    state.elapsed.enter,
  );
  const allTyped = typed.every((chars, i) => chars >= lineText(lines[i] as DataLine).length);
  const punctuation = { color: theme.colours.ink.faint };
  return (
    <div
      style={{
        ...markHostCss(theme),
        ...stateStyle(state),
        ...cardSurfaceCss(theme, semanticTint(theme, 'neutral'), state),
        width: box.width,
        height: box.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: `0 ${theme.space.lg}px`,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={theme.radius.md} />
      {props.title ? (
        <div
          style={{
            ...textCss(theme, 'label'),
            color: theme.colours.ink.muted,
            marginBottom: theme.space.xs,
          }}
        >
          {props.title}
        </div>
      ) : null}
      <div style={{ ...textCss(theme, 'data'), ...NO_WRAP, color: theme.colours.ink.primary }}>
        <div style={punctuation}>{'{'}</div>
        {lines.map((line, i) => (
          <FieldLine
            key={i}
            theme={theme}
            field={props.fields[i] as DataField}
            parts={visibleParts(line, typed[i] ?? 0)}
          />
        ))}
        <div style={{ ...punctuation, opacity: allTyped ? 1 : 0 }}>{'}'}</div>
      </div>
    </div>
  );
}

type FieldLineProps = { theme: Theme; field: DataField; parts: DataLine };

/** One `"key": value,` row; a field with a semantic colours its value and tints the row. */
function FieldLine({ theme, field, parts }: FieldLineProps) {
  const tint = field.semantic ? semanticTint(theme, field.semantic) : undefined;
  const typing = parts.indent.length > 0;
  return (
    <div
      style={{
        background: tint && typing ? tint.soft : 'transparent',
        borderRadius: theme.radius.sm,
      }}
    >
      {/* A non-breaking space keeps an untyped row at full height. */}
      {typing ? parts.indent : ' '}
      <span style={{ color: theme.colours.ink.muted }}>{parts.key}</span>
      <span style={{ color: tint?.base ?? theme.colours.ink.primary }}>{parts.value}</span>
      <span style={{ color: theme.colours.ink.faint }}>{parts.comma}</span>
    </div>
  );
}
