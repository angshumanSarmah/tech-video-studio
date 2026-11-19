import { BarHud } from './BarHud.tsx';
import { TitleBlockHud } from './TitleBlockHud.tsx';
import type { HudProps } from './use-hud-model.ts';

export type { HudProps } from './use-hud-model.ts';

/**
 * The HUD layer: top bar, step tracker, hero metric, chapter header, story clock, headline. The
 * card format (`meta.format: "card"`) draws the title block's persistent `header` variant in every
 * theme; the full format draws the theme's `hud.style`. The data and spec toggles are the same.
 */
export function Hud(props: HudProps) {
  if (props.spec.meta.format === 'card') return <TitleBlockHud {...props} variant="header" />;
  return props.theme.hud.style === 'title-block' ? (
    <TitleBlockHud {...props} variant="strip" />
  ) : (
    <BarHud {...props} />
  );
}
