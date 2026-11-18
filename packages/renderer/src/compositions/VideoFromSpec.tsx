import type { VideoFromSpecProps } from './props.ts';
import { SpecLayers } from './SpecLayers.tsx';

/** The whole video from a VideoSpec. Duration and fps come from `calculateVideoMetadata`. */
export function VideoFromSpec({ spec, series, audioSrc }: VideoFromSpecProps) {
  return <SpecLayers spec={spec} series={series} audioSrc={audioSrc} />;
}
