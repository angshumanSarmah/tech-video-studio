import type { CSSProperties, ReactNode } from 'react';
import { dimOpacity, type DrawLevels } from '../events/presets.ts';
import type { Size } from '../primitives/types.ts';
import type { OutlineShape } from './outline.ts';

/**
 * The one shared draw layer of the `draw` enter style. While an element draws, its outline shapes
 * (`PrimitiveDefinition.outline`) are stroked on along their length over it (a dash offset over a
 * unit `pathLength`) and the component itself (fills, text and its real border) fades in with
 * `fill`; an element without an outline fades in with the draw's `progress`. Once the draw ends
 * the layer is gone and the component renders exactly as it would without it. No component
 * animates its own draw.
 */

type Props = {
  draw: DrawLevels;
  /** The element's dim (0..1), so a drawn outline dims like the component it traces. */
  dimmed: number;
  /** Its outline shapes, or undefined when it has none. */
  shapes: readonly OutlineShape[] | undefined;
  box: Size;
  children: ReactNode;
};

export function DrawReveal({ draw, dimmed, shapes, box, children }: Props) {
  if (draw.progress >= 1) return <>{children}</>;
  const opacity = shapes ? draw.fill : draw.progress;
  return (
    <div style={{ position: 'relative', width: box.width, height: box.height }}>
      <div style={{ opacity }}>{children}</div>
      {shapes ? (
        <div style={{ position: 'absolute', inset: 0, opacity: dimOpacity(dimmed) }}>
          <DrawOutline shapes={shapes} stroke={draw.stroke} box={box} />
        </div>
      ) : null}
    </div>
  );
}

type OutlineProps = {
  shapes: readonly OutlineShape[];
  stroke: number;
  box: Size;
  /**
   * The parent's own border width when the outline traces that border: an absolute child sits
   * inside the border, so the layer moves out by it to share the parent's border box.
   */
  border?: number;
};

/** Outline shapes drawn to `stroke` (0..1) of their length, from each shape's start. */
export function DrawOutline({ shapes, stroke, box, border = 0 }: OutlineProps) {
  const style: CSSProperties = {
    position: 'absolute',
    left: -border,
    top: -border,
    overflow: 'visible',
  };
  return (
    <svg width={box.width} height={box.height} style={style}>
      {shapes.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={s.width}
          height={s.height}
          rx={s.radius}
          ry={s.radius}
          fill="none"
          stroke={s.colour}
          strokeWidth={s.strokeWidth}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - stroke}
        />
      ))}
    </svg>
  );
}
