import { Html5Audio } from 'remotion';

/**
 * The narration track for the whole video. Inside a shifted `<Sequence>` (see `BeatFromSpec`)
 * Remotion trims it to the visible frames, so a per-beat render plays just that beat's audio.
 */
export function NarrationAudio({ src }: { src: string }) {
  return <Html5Audio src={src} />;
}
