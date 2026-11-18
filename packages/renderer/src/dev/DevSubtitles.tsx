import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { rectCss } from '../layers/rect-css.ts';
import { safeAreas, textCss, type Theme } from '../theme/index.ts';
import type { BeatFrameSpan } from '../timing/frames.ts';
import { activeWordIndex, displayWords } from './dev-state.ts';

/**
 * TEMPORARY subtitle layer (P1A.3): fixed 4-word windows with the current word in the accent.
 * P1B.3 replaces it with chunked karaoke captions (breaks at punctuation and pauses).
 */

const WINDOW = 4;

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  spans: readonly BeatFrameSpan[];
  accent: string;
};

export function DevSubtitles({ theme, spec, timing, spans, accent }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { subtitleBand } = useMemo(() => safeAreas(theme), [theme]);
  const span = spans.findLast((s) => s.from <= frame);
  const beat = timing.beats.find((b) => b.beatId === span?.beatId);
  const narration = spec.script.find((s) => s.beatId === span?.beatId)?.narration;
  if (!beat || !narration) return null;

  const active = activeWordIndex(beat.words, frame / fps);
  if (active < 0) return null;
  const words = displayWords(narration);
  const start = Math.floor(active / WINDOW) * WINDOW;
  return (
    <div
      style={{
        ...rectCss(subtitleBand),
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0.3em',
        ...textCss(theme, 'subtitle'),
        color: theme.colours.ink.primary,
      }}
    >
      {words.slice(start, start + WINDOW).map((word, i) => (
        <span key={start + i} style={start + i === active ? { color: accent } : undefined}>
          {word}
        </span>
      ))}
    </div>
  );
}
