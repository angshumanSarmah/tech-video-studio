import { semanticTint, textCss, withAlpha, type Theme } from '../../theme/index.ts';
import type { PrimitiveComponentProps } from '../component-props.ts';
import { partState, type PartState } from '../element-state.ts';
import { emphasisFilter, markHostCss, markLevels } from '../../emphasis/emphasis.ts';
import { BoxMark } from '../../emphasis/Mark.tsx';
import type { GridOverlayProps } from './definition.ts';
import { cellRect, gridGeometry, type GridGeometry } from './grid.ts';

type Cell = GridOverlayProps['cells'][number];

const LINE_ALPHA = 0.55;
const CELL_FILL_ALPHA = 0.3;

/** How far above its place the grid starts when it drops in (`enter`). */
const DROP_SCALE = 0.15;

/** A grid laid over a map; cells light up by row and column. */
export function GridOverlay({
  theme,
  props,
  box,
  state,
}: PrimitiveComponentProps<GridOverlayProps>) {
  const g = gridGeometry(props.rows, props.cols, box);
  const lineTint = semanticTint(theme, 'concept');
  const scale = 1 + DROP_SCALE * (1 - state.presence);
  return (
    <div
      style={{
        ...markHostCss(theme),
        position: 'relative',
        width: box.width,
        height: box.height,
        opacity: state.presence * (1 - 0.7 * state.dimmed),
        transform: `scale(${scale})`,
      }}
    >
      <BoxMark theme={theme} levels={markLevels(state)} radius={0} size={box} />
      <svg
        width={box.width}
        height={box.height}
        style={{
          position: 'absolute',
          overflow: 'visible',
          filter: emphasisFilter(theme, lineTint, state.emphasis),
        }}
      >
        <GridLines
          theme={theme}
          g={g}
          rows={props.rows}
          cols={props.cols}
          colour={withAlpha(lineTint.base, LINE_ALPHA)}
        />
        {props.cells.map((cell) => (
          <CellFill
            key={cell.id}
            theme={theme}
            g={g}
            cell={cell}
            part={partState(state, cell.id)}
          />
        ))}
      </svg>
      {props.cells.map((cell) =>
        cell.label ? (
          <CellTag
            key={cell.id}
            theme={theme}
            g={g}
            cell={cell}
            text={cell.label}
            part={partState(state, cell.id)}
          />
        ) : null,
      )}
    </div>
  );
}

type GridLinesProps = { theme: Theme; g: GridGeometry; rows: number; cols: number; colour: string };

function GridLines({ theme, g, rows, cols, colour }: GridLinesProps) {
  return (
    <g stroke={colour} strokeWidth={theme.stroke.thin}>
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line
          key={`c${i}`}
          x1={g.x + i * g.cell}
          x2={g.x + i * g.cell}
          y1={g.y}
          y2={g.y + g.height}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, j) => (
        <line
          key={`r${j}`}
          x1={g.x}
          x2={g.x + g.width}
          y1={g.y + j * g.cell}
          y2={g.y + j * g.cell}
        />
      ))}
    </g>
  );
}

/** A cell is lit while emphasised (held highlight or pulse) or rejected. */
function cellLight(part: PartState): number {
  return Math.max(part.emphasis, part.actions.reject ?? 0) * (1 - 0.7 * part.dimmed);
}

function cellTint(theme: Theme, cell: Cell, part: PartState) {
  return semanticTint(theme, (part.actions.reject ?? 0) > 0 ? 'problem' : cell.semantic);
}

type CellProps = { theme: Theme; g: GridGeometry; cell: Cell; part: PartState };

function CellFill({ theme, g, cell, part }: CellProps) {
  const light = cellLight(part);
  if (light <= 0) return null;
  const tint = cellTint(theme, cell, part);
  const r = cellRect(g, cell.row, cell.col);
  return (
    <rect
      x={r.x}
      y={r.y}
      width={r.size}
      height={r.size}
      fill={withAlpha(tint.base, CELL_FILL_ALPHA * light)}
      stroke={tint.base}
      strokeWidth={theme.stroke.bold}
      strokeOpacity={light}
      style={{ filter: emphasisFilter(theme, tint, light) }}
    />
  );
}

/** The cell's tag sits above it, or below it on the top row. */
function CellTag({ theme, g, cell, text, part }: CellProps & { text: string }) {
  const light = cellLight(part);
  if (light <= 0) return null;
  const tint = cellTint(theme, cell, part);
  const r = cellRect(g, cell.row, cell.col);
  const above = cell.row > 1;
  return (
    <div
      style={{
        ...textCss(theme, 'tag'),
        position: 'absolute',
        left: r.x + r.size / 2,
        top: above ? r.y - theme.space.xs : r.y + r.size + theme.space.xs,
        transform: `translate(-50%, ${above ? '-100%' : '0'}) scale(${0.8 + 0.2 * light})`,
        padding: `${theme.space.xs}px ${theme.space.sm}px`,
        borderRadius: theme.radius.sm,
        background: tint.base,
        color: theme.colours.background,
        whiteSpace: 'nowrap',
        opacity: light,
        boxShadow: tint.glowShadow,
      }}
    >
      {text}
    </div>
  );
}
