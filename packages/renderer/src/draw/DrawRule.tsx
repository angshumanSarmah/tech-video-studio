import type { CSSProperties } from 'react';

/**
 * A straight CSS border drawn on along its length: a line `thickness` px wide on one edge of its
 * (positioned) parent, covering exactly the pixels that edge's border takes (an absolute child
 * sits inside the border, so it is offset out by the border's width), grown to `stroke`
 * (0..1) of the edge from its start (top or left). Shared by the HUD's ruled frames; the border
 * itself is transparent while it draws.
 */
type Props = {
  edge: 'top' | 'right' | 'bottom' | 'left';
  thickness: number;
  colour: string;
  stroke: number;
};

export function DrawRule({ edge, thickness, colour, stroke }: Props) {
  const along = `${Math.max(0, Math.min(1, stroke)) * 100}%`;
  const vertical = edge === 'left' || edge === 'right';
  const style: CSSProperties = {
    position: 'absolute',
    background: colour,
    [edge]: -thickness,
    ...(vertical
      ? { top: 0, width: thickness, height: along }
      : { left: 0, height: thickness, width: along }),
  };
  return <div style={style} />;
}
