import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { stageForBeat } from '../hud/hud-state.ts';
import { rectCss } from '../layers/rect-css.ts';
import { lineHeightPx } from '../primitives/measure.ts';
import { elementState } from '../primitives/element-state.ts';
import { safeAreas, textCss, type Rect, type Theme } from '../theme/index.ts';
import { beatWorld, type WorldItem } from './beat-world.ts';
import { scrimColour, scrimLevel, splitLayers, type PrimitiveItem } from './scene-layers.ts';
import { footnoteOpacity, footnoteRect, footnoteText } from './source-footnote.ts';
import { WorldItemView } from './WorldItemView.tsx';

/**
 * One beat's board: every element drawn by its registered component, with state from its anchored
 * events. Overlays (`statement_card`, `inset_panel`) are drawn centred over the stage above a
 * scrim that dims the board; their contained children are drawn inside them, above the scrim.
 * TEMPORARY placement: board elements flow in a centred wrap inside the stage at their preferred
 * size until the layout engine (P1A.9) computes positions, sizes and focus.
 */

type Props = {
  theme: Theme;
  spec: RenderableVideoSpec;
  timing: EffectiveTiming;
  beatId: string;
  /** Global frame the beat's `<Sequence>` starts at. */
  beatFrom: number;
};

export function BeatScene({ theme, spec, timing, beatId, beatFrom }: Props) {
  const frame = useCurrentFrame() + beatFrom;
  const { fps } = useVideoConfig();
  const layers = useMemo(
    () => splitLayers(beatWorld(spec, timing, beatId, fps, DEFAULT_REGISTRIES)),
    [spec, timing, beatId, fps],
  );
  const areas = useMemo(() => safeAreas(theme), [theme]);
  const stage = stageForBeat(areas, spec, beatId);
  const scrim = scrimLevel(
    layers.overlays.map((item) => elementState(item.events, frame, fps).presence),
  );
  const footnote = footnoteText(spec, beatId);
  const beatStartSec = timing.beats.find((b) => b.beatId === beatId)?.startSec ?? 0;
  return (
    <>
      <Board theme={theme} stage={stage} items={layers.board} frame={frame} fps={fps} />
      {scrim > 0 ? <AbsoluteFill style={{ background: scrimColour(theme, scrim) }} /> : null}
      <Overlays theme={theme} stage={stage} items={layers.overlays} frame={frame} fps={fps} />
      {footnote ? (
        <SourceFootnote
          theme={theme}
          text={footnote}
          rect={footnoteRect(
            stage,
            areas.avoidZones,
            lineHeightPx(theme, 'footnote'),
            theme.space.md,
          )}
          opacity={footnoteOpacity(frame / fps, beatStartSec)}
        />
      ) : null}
    </>
  );
}

type LayerProps<T> = { theme: Theme; stage: Rect; items: T[]; frame: number; fps: number };

function Board({ theme, stage, items, frame, fps }: LayerProps<WorldItem>) {
  return (
    <div
      style={{
        ...rectCss(stage),
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.lg,
      }}
    >
      {items.map((item) => (
        <WorldItemView key={item.key} theme={theme} item={item} frame={frame} fps={fps} />
      ))}
    </div>
  );
}

/** Overlays share the stage's centre (validation warns when two show at once). */
function Overlays({ theme, stage, items, frame, fps }: LayerProps<PrimitiveItem>) {
  if (items.length === 0) return null;
  return (
    <div style={{ ...rectCss(stage), display: 'grid', placeItems: 'center' }}>
      {items.map((item) => (
        <div key={item.key} style={{ gridArea: '1 / 1' }}>
          <WorldItemView theme={theme} item={item} frame={frame} fps={fps} />
        </div>
      ))}
    </div>
  );
}

type FootnoteProps = { theme: Theme; text: string; rect: Rect; opacity: number };

function SourceFootnote({ theme, text, rect, opacity }: FootnoteProps) {
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        ...rectCss(rect),
        ...textCss(theme, 'footnote'),
        color: theme.colours.ink.faint,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity,
      }}
    >
      {text}
    </div>
  );
}
