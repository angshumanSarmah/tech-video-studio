import { useMemo } from 'react';
import { Sequence, useVideoConfig } from 'remotion';
import { findBeatSpan } from './metadata.ts';
import type { BeatFromSpecProps } from './props.ts';
import { SpecLayers } from './SpecLayers.tsx';

/**
 * One beat, cut from the global timeline: the layers are shifted back by the beat's start frame,
 * so every frame (scene, HUD, subtitles, audio) matches the same frame of `VideoFromSpec`.
 */
export function BeatFromSpec({ spec, series, audioSrc, beatId }: BeatFromSpecProps) {
  const { fps } = useVideoConfig();
  const span = useMemo(() => findBeatSpan(spec, beatId, fps), [spec, beatId, fps]);
  return (
    <Sequence from={-span.from} name={`Timeline from beat ${beatId}`}>
      <SpecLayers spec={spec} series={series} audioSrc={audioSrc} onlyBeatId={beatId} />
    </Sequence>
  );
}
