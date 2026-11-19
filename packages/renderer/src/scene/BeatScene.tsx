import type { EffectiveTiming, RenderableVideoSpec } from '@explainer-studio/shared';
import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { DEFAULT_REGISTRIES } from '../catalog/registries.ts';
import { rectCss } from '../layers/rect-css.ts';
import type { Transform } from '../layout/fit.ts';
import { inflate } from '../layout/rect.ts';
import { specLayout } from '../layout/spec-layout.ts';
import { boxOf, type Guide, type PlacedItem } from '../layout/types.ts';
import { dimOpacity } from '../events/presets.ts';
import { elementState } from '../primitives/element-state.ts';
import { textCss, type Rect, type Theme } from '../theme/index.ts';
import { beatWorld, type WorldItem } from './beat-world.ts';
import { overlayLevel, splitLayers } from './scene-layers.ts';
import { footnoteOpacity, footnoteText } from './source-footnote.ts';
import { WorldItemView } from './WorldItemView.tsx';

/**
 * One beat's board, placed by the layout engine (`specLayout`: one placement per
 * `continuesPrevious` chain, computed once per spec). Board items are drawn back to front at their
 * placed rects under the beat's camera (a uniform zoom and pan of the board layer, clipped to the
 * board frame); overlays are drawn at their own rects above it, with their contained children
 * where the nested layout put them (while one shows, the board dims through its elements' focus
 * track); the source footnote sits where the layout reserved it.
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
  const beat = specLayout(spec, theme).beats.get(beatId);
  if (!beat) return null;
  const { board, footnote } = beat.chain;
  const overlays = overlayLevel(
    layers.overlays.map((item) => elementState(item.events, frame, fps).presence),
  );
  const footnoteLine = footnoteText(spec, beatId);
  const beatStartSec = timing.beats.find((b) => b.beatId === beatId)?.startSec ?? 0;
  return (
    <>
      <Board
        theme={theme}
        clip={inflate(board.frame, theme.space.sm)}
        camera={beat.camera}
        guides={board.guides}
        guideOpacity={dimOpacity(overlays)}
        items={layers.board}
        placed={board.items}
        frame={frame}
        fps={fps}
      />
      {layers.overlays.map((item) => (
        <Placed
          key={item.key}
          theme={theme}
          item={item}
          placed={board.overlays.find((p) => p.key === item.key)}
          frame={frame}
          fps={fps}
        />
      ))}
      {footnote && footnoteLine ? (
        <SourceFootnote
          theme={theme}
          text={footnoteLine}
          rect={footnote}
          opacity={footnoteOpacity(frame / fps, beatStartSec)}
        />
      ) : null}
    </>
  );
}

type BoardProps = {
  theme: Theme;
  clip: Rect;
  camera: Transform;
  guides: readonly Guide[];
  guideOpacity: number;
  items: readonly WorldItem[];
  placed: readonly PlacedItem[];
  frame: number;
  fps: number;
};

/** The board layer: canvas-space items under the camera, clipped to the (padded) board frame. */
function Board(props: BoardProps) {
  const { theme, clip, camera, guides, guideOpacity, items, placed, frame, fps } = props;
  const byKey = new Map(items.map((item) => [item.key, item]));
  return (
    <div style={{ ...rectCss(clip), overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: -clip.x,
          top: -clip.y,
          width: theme.canvas.width,
          height: theme.canvas.height,
          transform: `translate(${camera.dx}px, ${camera.dy}px) scale(${camera.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <Guides theme={theme} guides={guides} opacity={guideOpacity} />
        {placed.map((p) => {
          const item = byKey.get(p.key);
          return item ? (
            <Placed key={p.key} theme={theme} item={item} placed={p} frame={frame} fps={fps} />
          ) : null;
        })}
      </div>
    </div>
  );
}

type PlacedProps = {
  theme: Theme;
  item: WorldItem;
  placed: PlacedItem | undefined;
  frame: number;
  fps: number;
};

/** One item at its placed rect: drawn in its own box px and scaled to the rect. */
function Placed({ theme, item, placed, frame, fps }: PlacedProps) {
  if (!placed) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: placed.rect.x,
        top: placed.rect.y,
        ...boxOf(placed),
        transform: `scale(${placed.scale})`,
        transformOrigin: '0 0',
      }}
    >
      <WorldItemView theme={theme} item={item} frame={frame} fps={fps} placed={placed} />
    </div>
  );
}

/** Faint lines the mode draws (swimlane lifelines, the versus divider). */
type GuidesProps = { theme: Theme; guides: readonly Guide[]; opacity: number };

function Guides({ theme, guides, opacity }: GuidesProps) {
  if (guides.length === 0) return null;
  const stroke = theme.stroke.thin;
  return (
    <svg
      width={theme.canvas.width}
      height={theme.canvas.height}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity }}
    >
      {guides.map((g, i) => (
        <line
          key={i}
          x1={g.from.x}
          y1={g.from.y}
          x2={g.to.x}
          y2={g.to.y}
          stroke={theme.colours.ink.faint}
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 4} ${stroke * 4}`}
        />
      ))}
    </svg>
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
