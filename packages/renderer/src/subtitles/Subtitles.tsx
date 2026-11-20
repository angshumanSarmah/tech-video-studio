import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import {
  focusUnderlineView,
  underlineBandCss,
  UNDERLINE_OVERHANG,
  type UnderlineView,
} from '../emphasis/emphasis.ts';
import { rectCss } from '../layers/rect-css.ts';
import { formatAreas } from '../layout/format.ts';
import { textCss, type Theme } from '../theme/index.ts';
import { buildSubtitleCues, SUBTITLE_STYLE, type SubtitleCue } from './cues.ts';
import { activeWordIndex, cueAt, underlineSpan } from './subtitle-state.ts';

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  /** The series accent, already adapted to the theme (`seriesAccent`). */
  accent: string;
};

/**
 * Word-by-word karaoke captions in the format's subtitle band, one cue (2–4 words, one line) at
 * a time, from `buildSubtitleCues`: the same cues the worker writes to the SRT.
 *
 * The current word follows the theme's emphasis style: in `glow` themes it is drawn in the series
 * accent; in `mark` themes every word stays ink and the focus underline band (as
 * `FocusUnderline` draws it) slides under the current word. Words sit at their measured offsets,
 * so the line never reflows as the current word moves.
 */
export function Subtitles({ theme, spec, timing, accent }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cues = useMemo(() => buildSubtitleCues(spec, theme, timing), [spec, theme, timing]);
  const band = useMemo(
    () => formatAreas(theme, spec.meta.format).subtitleBand,
    [theme, spec.meta.format],
  );
  const sec = frame / fps;
  const cue = cueAt(cues, sec);
  if (!cue) return null;
  return (
    <div
      style={{
        ...rectCss(band),
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <CueLine theme={theme} cue={cue} sec={sec} accent={accent} />
    </div>
  );
}

type CueLineProps = { theme: Theme; cue: SubtitleCue; sec: number; accent: string };

function CueLine({ theme, cue, sec, accent }: CueLineProps) {
  const style = textCss(theme, SUBTITLE_STYLE);
  const view = focusUnderlineView(theme, 'focus');
  const active = activeWordIndex(cue, sec);
  const lineHeight = theme.text[SUBTITLE_STYLE].size * theme.text[SUBTITLE_STYLE].lineHeight;
  return (
    <div
      data-testid="subtitle-cue"
      style={{
        position: 'relative',
        isolation: 'isolate',
        flex: 'none',
        width: cue.width,
        height: lineHeight,
        transform: cue.scale < 1 ? `scale(${cue.scale})` : undefined,
        ...style,
        color: theme.colours.ink.primary,
        whiteSpace: 'pre',
      }}
    >
      {view ? <WordBand view={view} cue={cue} sec={sec} /> : null}
      {cue.words.map((word, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: word.x,
            top: 0,
            color: !view && i === active ? accent : undefined,
          }}
        >
          {word.text}
        </span>
      ))}
    </div>
  );
}

function WordBand({ view, cue, sec }: { view: UnderlineView; cue: SubtitleCue; sec: number }) {
  const { x, width } = underlineSpan(cue, sec);
  return (
    <span
      data-testid="subtitle-band"
      style={{
        ...underlineBandCss(view),
        left: x - UNDERLINE_OVERHANG,
        width: width + 2 * UNDERLINE_OVERHANG,
        zIndex: -1,
      }}
    />
  );
}
