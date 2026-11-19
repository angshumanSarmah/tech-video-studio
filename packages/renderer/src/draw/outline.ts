import type { Size } from '../primitives/types.ts';

/**
 * Outlines the `draw` enter style draws on (`PrimitiveDefinition.outline`): shapes in the
 * element's box px that trace exactly the borders its component draws, so the drawn line hands
 * over to the real border with no visible change. React-free.
 */

/** A rounded rectangle stroked along its centreline. */
export type OutlineShape = {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  strokeWidth: number;
  colour: string;
};

/**
 * The centreline of a CSS border on a `border-box` element of `size`: inset by half the border
 * width, with the radius of the border's middle (the CSS radius less half the width).
 */
export function borderOutline(
  size: Size,
  radius: number,
  strokeWidth: number,
  colour: string,
): OutlineShape {
  const half = strokeWidth / 2;
  return {
    kind: 'rect',
    x: half,
    y: half,
    width: Math.max(0, size.width - strokeWidth),
    height: Math.max(0, size.height - strokeWidth),
    radius: Math.max(0, radius - half),
    strokeWidth,
    colour,
  };
}

/** Length of one shape's stroke (px). */
export function shapeLength(shape: OutlineShape): number {
  const r = Math.min(shape.radius, shape.width / 2, shape.height / 2);
  return 2 * (shape.width + shape.height) - 8 * r + 2 * Math.PI * r;
}

/** Total stroke length of an outline (px). */
export function outlineLength(shapes: readonly OutlineShape[]): number {
  return shapes.reduce((sum, s) => sum + shapeLength(s), 0);
}
