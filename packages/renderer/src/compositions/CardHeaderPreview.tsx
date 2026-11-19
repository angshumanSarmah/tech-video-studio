import type { VideoFromSpecProps } from './props.ts';
import { SpecLayers } from './SpecLayers.tsx';

/**
 * `VideoFromSpec` with the card format's persistent header (the title block's `header` variant)
 * as its HUD, for review before P1A.9. P1A.9 replaces it with `meta.format: "card"`.
 */
export function CardHeaderPreview({
  spec,
  series,
  audioSrc,
  channelHandle,
  themeId,
}: VideoFromSpecProps) {
  return (
    <SpecLayers
      spec={spec}
      series={series}
      audioSrc={audioSrc}
      channelHandle={channelHandle}
      themeId={themeId}
      cardHeader
    />
  );
}
