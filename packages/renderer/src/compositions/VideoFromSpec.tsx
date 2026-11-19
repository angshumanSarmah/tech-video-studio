import type { VideoFromSpecProps } from './props.ts';
import { SpecLayers } from './SpecLayers.tsx';

/** The whole video from a VideoSpec. Duration and fps come from `calculateVideoMetadata`. */
export function VideoFromSpec({
  spec,
  series,
  audioSrc,
  channelHandle,
  themeId,
  assets,
}: VideoFromSpecProps) {
  return (
    <SpecLayers
      spec={spec}
      series={series}
      audioSrc={audioSrc}
      channelHandle={channelHandle}
      themeId={themeId}
      assets={assets}
    />
  );
}
