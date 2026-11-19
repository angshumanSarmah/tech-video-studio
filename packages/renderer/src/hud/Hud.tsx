import { BarHud } from './BarHud.tsx';
import { TitleBlockHud } from './TitleBlockHud.tsx';
import type { HudProps } from './use-hud-model.ts';

export type { HudProps } from './use-hud-model.ts';

type Props = HudProps & {
  /**
   * Draw the card format's persistent header (the title block's `header` variant) instead of the
   * theme's HUD. Temporary until P1A.9 derives it from `meta.format`.
   */
  cardHeader?: boolean;
};

/**
 * The HUD layer: top bar, step tracker, hero metric, chapter header, story clock, headline. The
 * theme's `hud.style` picks how they are drawn; the data and spec toggles are the same.
 */
export function Hud({ cardHeader = false, ...props }: Props) {
  if (cardHeader) return <TitleBlockHud {...props} variant="header" />;
  return props.theme.hud.style === 'title-block' ? (
    <TitleBlockHud {...props} variant="strip" />
  ) : (
    <BarHud {...props} />
  );
}
